/**
 * Skill usage telemetry sidecar: `$DSH_HOME/skills/.usage.json`.
 * Format-compatible with Hermes Agent / hermes-claw core fields.
 */

import { join } from 'node:path'
import { nodeEvolutionIo, transactIo, type EvolutionIoLike } from './io.ts'

type SkillState = 'active' | 'stale' | 'archived'

export interface UsageRecord {
  created_by: string | null
  use_count: number
  view_count: number
  patch_count: number
  last_used_at: string | null
  last_viewed_at: string | null
  last_patched_at: string | null
  created_at: string
  state: SkillState
  pinned: boolean
  archived_at: string | null
  quality_score?: number | undefined
  quality_warn?: boolean | undefined
  /** P1-1 (v15): feedback-owned quality signal. Field ownership contract —
   * `quality_score`/`quality_warn` are written ONLY by the curator's
   * six-factor `scoreTree`; `feedback_score`/`feedback_warn` are written ONLY
   * by the feedback channel (`SkillUsageRegistry.setFeedbackQuality`);
   * `foldCuratorFields` refreshes the quality_* pair tree-wide and must never
   * touch feedback_*. The lifecycle engine and the scope view read the UNION
   * of both warn flags, which is what makes negative feedback decision-
   * relevant again. */
  feedback_score?: number | undefined
  feedback_warn?: boolean | undefined
  /** Demand evidence per SUPPORT FILE (design §5.5): how many observed reads
   * landed on each `references/…`-style path of this skill. Absent on every
   * record written before this field existed, and on skills whose support
   * files were never read — absence means "no evidence", never "zero demand". */
  support_reads?: Record<string, number> | undefined
}

export type UsageMap = Map<string, UsageRecord>

export function usageFile(root: string): string {
  return join(root, '.usage.json')
}

export function emptyRecord(): UsageRecord {
  return {
    created_by: null,
    use_count: 0,
    view_count: 0,
    patch_count: 0,
    last_used_at: null,
    last_viewed_at: null,
    last_patched_at: null,
    created_at: new Date().toISOString(),
    state: 'active',
    pinned: false,
    archived_at: null,
  }
}

/** A timestamp passes only when `Date.parse` yields a finite epoch (N-3): a bare
 * string check let garbage like "not-a-date" propagate as Invalid Date → NaN
 * into quality math and lifecycle comparisons. */
const validTimestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const nullableTimestamp = (value: unknown): value is string | null => value === null || validTimestamp(value)

/**
 * Field-level normalization for one sidecar record (rc.42 audit P2-3): the
 * spread used to copy any junk through verbatim, so a corrupted file could
 * carry `use_count: "3"` into the quality math and lifecycle comparisons as
 * NaN. Every field falls back to its `emptyRecord()` baseline unless it has
 * exactly the declared type; an invalid `created_at` anchors the age clock at
 * now (first-sight defer semantics for a record whose age is unknowable).
 * Timestamps additionally require a parseable date (N-3): `"not-a-date"`
 * would otherwise survive the type check as Invalid Date.
 * Pure — exported for unit tests; `loadUsage` is the production caller.
 */
export function normalizeUsageRecord(record: unknown): UsageRecord {
  const base = emptyRecord()
  if (!record || typeof record !== 'object' || Array.isArray(record)) return base
  const raw = record as Record<string, unknown>
  // C-09: counters are cardinalities — a negative value from a
  // corrupted sidecar falls back to the baseline instead of poisoning the
  // quality math and the write-ghost judgment (1e300-class magnitudes still
  // pass; only the sign domain is closed here).
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback
  return {
    // v28 G5.2 (USAGE-01): unknown fields pass through UNTOUCHED and land
    // before the known keys, so a newer writer's per-record fields survive
    // this runtime's write-side RMW (mutateUsage persists the rebuilt map).
    // The family's forward-compat discipline (A2-11/L-1/F-338) gates on the
    // top-level file version, but the usage writer emits none — without this
    // spread the first counter bump stripped every unknown field. Known keys
    // are overridden below and stay strictly sanitized; a malformed value
    // falls back exactly as before.
    ...raw,
    created_by: typeof raw.created_by === 'string' ? raw.created_by : null,
    use_count: num(raw.use_count, base.use_count),
    view_count: num(raw.view_count, base.view_count),
    patch_count: num(raw.patch_count, base.patch_count),
    last_used_at: nullableTimestamp(raw.last_used_at) ? raw.last_used_at : base.last_used_at,
    last_viewed_at: nullableTimestamp(raw.last_viewed_at) ? raw.last_viewed_at : base.last_viewed_at,
    last_patched_at: nullableTimestamp(raw.last_patched_at) ? raw.last_patched_at : base.last_patched_at,
    // An unknowable age anchors at now: the record's inactivity clock starts
    // today instead of counting from epoch.
    created_at: validTimestamp(raw.created_at) ? raw.created_at : base.created_at,
    state: raw.state === 'stale' || raw.state === 'archived' ? raw.state : 'active',
    pinned: bool(raw.pinned, base.pinned),
    archived_at: nullableTimestamp(raw.archived_at) ? raw.archived_at : base.archived_at,
    quality_score: typeof raw.quality_score === 'number' && Number.isFinite(raw.quality_score) ? raw.quality_score : undefined,
    quality_warn: typeof raw.quality_warn === 'boolean' ? raw.quality_warn : undefined,
    feedback_score: typeof raw.feedback_score === 'number' && Number.isFinite(raw.feedback_score) ? raw.feedback_score : undefined,
    feedback_warn: typeof raw.feedback_warn === 'boolean' ? raw.feedback_warn : undefined,
    support_reads: normalizeSupportReads(raw.support_reads),
  }
}

/** Sidecar bound: a pathological path set must not grow the usage file forever. */
export const MAX_SUPPORT_READ_PATHS = 200

/** Sanitize the per-support-file read counts: non-negative finite numbers under
 * non-empty, bounded, non-traversal path keys. An unusable value drops the whole
 * map (absence over a poisoned count). */
function normalizeSupportReads(value: unknown): Record<string, number> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, number> = {}
  let kept = 0
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (kept >= MAX_SUPPORT_READ_PATHS) break
    if (key === '' || key.length > 200 || key.split('/').includes('..')) continue
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) continue
    out[key] = count
    kept += 1
  }
  return kept === 0 ? undefined : out
}

/** Parse a raw usage sidecar; malformed content reads as empty (best-effort telemetry). */
function parseUsage(raw: string | null): UsageMap {
  const map: UsageMap = new Map()
  if (raw === null) return map
  try {
    const parsed = JSON.parse(raw) as unknown
    // V6-20 (0.3.37): a top-level ARRAY must not fold into "0"/"1" phantom
    // skill records and be persisted as an object map (parseSuppressed /
    // normalizeUsageRecord already guard their entry shapes — this is the
    // missing top-level guard).
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return map
    for (const [name, record] of Object.entries(parsed as Record<string, unknown>)) {
      map.set(name, normalizeUsageRecord(record))
    }
  } catch {
    // Malformed sidecar is treated as empty.
  }
  return map
}

export async function loadUsage(root: string, io: EvolutionIoLike = nodeEvolutionIo()): Promise<UsageMap> {
  return parseUsage(await io.readText(usageFile(root)))
}

/**
 * Atomic read-modify-write on the usage sidecar (rc.50 P2-2): `task` receives
 * the map parsed from the current on-disk state and may mutate it; the result
 * is persisted inside the same transact so a second process sharing DSH_HOME
 * cannot interleave its RMW and lose a counter update. Callers keep their own
 * single-process serialize chain as the second layer.
 */
export interface UsageMutateOptions {
  /** P2-9 (v19): called when malformed entries had to be quarantined before the
   * task could run. The guard preserves bytes AND keeps the facility working;
   * this callback is how that stays observable. */
  onQuarantine?: ((message: string) => void) | undefined
}

export async function mutateUsage(
  root: string,
  io: EvolutionIoLike,
  task: (map: UsageMap) => void | Promise<void>,
  options: UsageMutateOptions = {},
): Promise<void> {
  await transactIo(io, usageFile(root), async (current) => {
    // P3 (v3 audit): a malformed sidecar is never overwritten by the RMW —
    // JSON.parse swallow→empty then persist would destroy recoverable telemetry.
    // P3 (v17): the same preserve applies to "valid JSON, wrong top-level
    // shape" (array/scalar) — parseUsage folds those to an empty map, and
    // persisting that would DESTROY the original bytes (mutations.ts and the
    // suppression sidecar both keep array compat; usage is the odd one out).
    // v21 (L-1): the WHOLE-FILE branches (unparsable JSON / array / scalar)
    // used to freeze every later RMW as a SILENT no-op — telemetry counts,
    // feedback and the curator's lifecycle fold all stopped landing with no
    // throw and no warn (the exact defect shape the v19 P2-9 note fixed for
    // the malformed-ENTRIES case). Same healing posture as state-json's E-9:
    // quarantine the original bytes, warn via onQuarantine, continue with an
    // empty map. A FAILED quarantine copy keeps the freeze but says so — the
    // bytes on disk stay the only recovery source, so overwriting them is
    // refused (v21 L-2, the P2-17 discipline state-json already follows).
    let shapePreserved = false
    let recovered: string | null = null
    const quarantineCopy = async (): Promise<boolean> => {
      const corruptPath = `${usageFile(root)}.corrupt`
      return io.writeText(corruptPath, current as string).then(() => true, () => false)
    }
    if (current !== null) {
      let parsed: Record<string, unknown> | null = null
      try {
        const probe = JSON.parse(current) as unknown
        if (probe !== null && typeof probe === 'object' && !Array.isArray(probe)) parsed = probe as Record<string, unknown>
      } catch { parsed = null }
      if (parsed === null) {
        // Whole-file corruption (unparsable JSON) or wrong top-level shape
        // (array/scalar): quarantine + warn + restart empty (parseUsage folds
        // the preserved bytes to an empty map below).
        const copied = await quarantineCopy()
        if (!copied) {
          options.onQuarantine?.(`usage sidecar ${usageFile(root)} is unreadable; the .corrupt copy could not be written — refusing this write so the original bytes stay recoverable (telemetry is frozen until the file is recovered manually)`)
          return current
        }
        options.onQuarantine?.(`usage sidecar ${usageFile(root)} is unreadable (unparsable JSON or wrong top-level shape); the original bytes were copied to ${usageFile(root)}.corrupt and the sidecar restarts empty`)
      } else {
        const record = parsed
        const isMalformed = (value: unknown): boolean => value === null || typeof value !== 'object' || Array.isArray(value)
        // A2-11 (v18): a newer on-disk version is never downgraded by this
        // writer (a skill literally named `version` holds an object, not a
        // number, so this cannot false-positive on a usage map). v21 (L-1):
        // the freeze now says so — the old silence was indistinguishable from
        // a dead pipeline.
        if (typeof record.version === 'number' && record.version > 1) {
          // S3-5 (J-6): the SAME refusal its siblings report. Handing the message
          // to `onQuarantine` alone made the freeze silent whenever the caller had
          // no callback — the one artifact of the four whose version refusal could
          // go unreported (pinned by tests/version-policy-uniformity.spec.ts).
          const message = `usage sidecar ${usageFile(root)} carries schema version ${String(record.version)} (> this runtime) — writes stay frozen and the bytes preserved until the runtime is upgraded`
          if (options.onQuarantine !== undefined) options.onQuarantine(message)
          else console.warn(message)
          shapePreserved = true
        } else if (Object.values(record).some(isMalformed)) {
          // P2-9 (v19): keep the original bytes in a quarantine copy, warn,
          // and continue with the good entries so the facility heals itself.
          // v21 (L-2): when the rescue copy ITSELF fails, refuse the write
          // instead of destroying the only recoverable bytes — and never
          // claim a copy exists when it does not.
          const bad = Object.keys(record).filter(key => isMalformed(record[key]))
          const copied = await quarantineCopy()
          if (!copied) {
            options.onQuarantine?.(`usage sidecar ${usageFile(root)} carried ${bad.length} malformed entr${bad.length === 1 ? 'y' : 'ies'} (${bad.slice(0, 5).join(', ')}); the .corrupt copy could not be written — refusing this write so the original bytes stay recoverable`)
            return current
          }
          recovered = JSON.stringify(Object.fromEntries(Object.entries(record).filter(([, value]) => !isMalformed(value))))
          options.onQuarantine?.(`usage sidecar ${usageFile(root)} carried ${bad.length} malformed entr${bad.length === 1 ? 'y' : 'ies'} (${bad.slice(0, 5).join(', ')}); the original bytes were copied to ${usageFile(root)}.corrupt and the remaining entries continue to be served`)
        }
      }
    }
    if (shapePreserved) return current
    const map = parseUsage(recovered ?? current)
    await task(map)
    return JSON.stringify(Object.fromEntries(map.entries()), null, 2)
  })
}

/** Curator-owned usage fields (rc.67 K-2): the curator writes ONLY this set —
 * lifecycle state, archive stamp, the six-factor quality pair, and the
 * marker-mirrored pin flag; counters and activity stamps belong to the
 * tool-telemetry side and are never copied by a fold. P2-12 (v39): the
 * combined `applyCuratorFields` wrapper had no production caller (folds go
 * through {@link foldCuratorFields}), so the two field copies below are the
 * whole contract. */

/** Copy only the lifecycle pair (state/archived_at) — see the ownership split
 * rationale above. */
export function applyCuratorLifecycleFields(disk: UsageRecord, curated: UsageRecord): void {
  disk.state = curated.state
  disk.archived_at = curated.archived_at
}

/**
 * Copy the recomputed meta pair (quality_score/quality_warn + the
 * marker-mirrored pin flag) — refreshed tree-wide each run by design, so a
 * concurrent curator run's lifecycle changes are never reverted by them.
 * P1-1 (v15): the feedback pair (`feedback_score`/`feedback_warn`) is
 * deliberately NOT copied — it is feedback-owned (see the field-ownership
 * contract on {@link UsageRecord}) and must survive curator runs untouched.
 */
export function applyCuratorMetaFields(disk: UsageRecord, curated: UsageRecord): void {
  disk.quality_score = curated.quality_score
  disk.quality_warn = curated.quality_warn
  disk.pinned = curated.pinned
}

/**
 * Fold a curator run-start snapshot onto the current on-disk map (rc.67 K-2):
 * each curated record is projected onto its disk peer by copying only the
 * curator-owned fields, so a concurrent tool-side bump between snapshot and
 * save survives. Records absent from the snapshot are left untouched; a
 * curated record with no disk peer is seeded from the snapshot. `stateOwned`
 * (rc.72 H-1) restricts the lifecycle pair to the names this run ACTUALLY
 * transitioned — a concurrent curator run's archive/restore is never reverted
 * by a stale snapshot; without it both pairs apply everywhere.
 */
export function foldCuratorFields(
  disk: UsageMap,
  curated: UsageMap,
  stateOwned?: ReadonlySet<string>,
  runStartStates?: ReadonlyMap<string, string>,
): string[] {
  // A2-4 (v18): names whose lifecycle fold was REFUSED because the on-disk
  // state no longer equals the run-start state (another process moved them).
  const skipped: string[] = []
  for (const [name, record] of curated) {
    const diskRecord = disk.get(name)
    if (!diskRecord) {
      disk.set(name, { ...record })
      continue
    }
    applyCuratorMetaFields(diskRecord, record)
    if (stateOwned === undefined || stateOwned.has(name)) {
      // A2-4 (v18): compare-and-set on the lifecycle pair. The run-start state
      // is the basis this run decided from; a different on-disk state means a
      // concurrent run/process already moved the skill, and its archive or
      // restore must win rather than be reverted to this run's stale snapshot.
      // An unknown start state keeps the previous behavior — the name is in
      // `stateOwned` precisely because this run transitioned it.
      const expected = runStartStates?.get(name)
      if (expected !== undefined && diskRecord.state !== expected) {
        skipped.push(name)
        continue
      }
      applyCuratorLifecycleFields(diskRecord, record)
    }
  }
  return skipped
}

/** Whole-file usage write (V6-37, 0.3.37): this is the ONE path that bypasses
 * the malformed-defense and the transact lock — prefer `mutateUsage` for any
 * read-modify-write so a concurrent writer cannot lose its update and a
 * malformed sidecar stays recoverable. Kept for fixture/test seeding.
 * @internal P3-16 (v14): no production caller (verified by grep); exported for
 * the family's tests only. Do not use it to write the sidecar in new code. */
export async function saveUsage(root: string, map: UsageMap, io: EvolutionIoLike = nodeEvolutionIo()): Promise<void> {
  const obj = Object.fromEntries(map.entries())
  await io.writeText(usageFile(root), JSON.stringify(obj, null, 2))
}

export function getRecord(map: UsageMap, name: string): UsageRecord {
  let record = map.get(name)
  if (!record) {
    record = emptyRecord()
    map.set(name, record)
  }
  return record
}

export function bumpView(map: UsageMap, name: string, when = new Date()): void {
  const record = getRecord(map, name)
  record.view_count += 1
  record.last_viewed_at = when.toISOString()
}

export function bumpUse(map: UsageMap, name: string, when = new Date()): void {
  const record = getRecord(map, name)
  record.use_count += 1
  record.last_used_at = when.toISOString()
}

export function bumpPatch(map: UsageMap, name: string, when = new Date()): void {
  const record = getRecord(map, name)
  record.patch_count += 1
  record.last_patched_at = when.toISOString()
}

/** Count one observed support-file read (design §5.5). The map is created on
 * first evidence only — a skill with no support reads keeps the field absent. */
export function bumpSupportRead(map: UsageMap, name: string, rel: string, when = new Date()): void {
  const record = getRecord(map, name)
  const counts = record.support_reads ?? {}
  counts[rel] = (counts[rel] ?? 0) + 1
  record.support_reads = counts
  // The newest read is the demand clock; reuse the view timestamp so no extra
  // field has to be introduced (a support read IS a read of the skill).
  record.last_viewed_at = when.toISOString()
}

export function markAgentCreated(map: UsageMap, name: string): void {
  getRecord(map, name).created_by = 'agent'
}

export function latestActivityAt(record: UsageRecord): string | null {
  // 0.3.16 (E-46): lexical ISO sorting misorders numeric offsets (+08:00 vs Z
  // for the same instant) — compare by Date.parse; unparseable values count
  // as absent.
  const values = [record.last_used_at, record.last_viewed_at, record.last_patched_at]
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
  if (values.length === 0) return null
  return values.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest))
}

/** Days between an ISO timestamp (falling back to `created`) and `now`. An
 * unparseable date counts as 0 days: NaN silently froze every age comparison
 * (A2-9). */
export function daysSinceIso(iso: string | null, created: string, nowMs: number): number {
  const t = Date.parse(iso ?? created)
  if (!Number.isFinite(t)) return 0
  return (nowMs - t) / 86_400_000
}

/** Idle days of one skill since its lifecycle age anchor (`last activity ??
 * created_at`) — the SAME anchor the curator's transitions use, so the
 * maintenance view and the lifecycle can never disagree about staleness. */
export function idleDays(record: UsageRecord, now: Date = new Date()): number {
  return daysSinceIso(latestActivityAt(record), record.created_at, now.getTime())
}

/**
 * Whether the library has ANY observed read evidence (C observation window):
 * reads were invisible to the usage sidecar before A2, so `view_count` zero
 * means "never read" ONLY after the first observed read exists anywhere in
 * the map. Before that, churn-based signals (write-ghost) are untrustworthy
 * and callers must suppress them. Pure and derived — never persisted.
 */
export function usageObserved(usage: ReadonlyMap<string, UsageRecord>): boolean {
  for (const record of usage.values()) {
    if (record.view_count > 0) return true
  }
  return false
}

/**
 * Curator suppression sidecar: built-in skills the curator has archived stay
 * suppressed across re-seeds, so the lifecycle never fights a re-created
 * bundled skill. Best-effort load/save, mirroring the usage sidecar posture.
 * Versioned shape ({ version, names }) with legacy plain-array compat.
 */
export const SUPPRESSED_FILE_VERSION = 1

export function suppressedFile(root: string): string {
  return join(root, '.curator-suppressed.json')
}

export async function loadSuppressedNames(root: string, io: EvolutionIoLike = nodeEvolutionIo()): Promise<ReadonlySet<string>> {
  return parseSuppressed(await io.readText(suppressedFile(root)))
}

function parseSuppressed(raw: string | null): Set<string> {
  if (raw === null) return new Set()
  try {
    const parsed = JSON.parse(raw) as unknown
    const names = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { names?: unknown }).names)
        ? (parsed as { names: unknown[] }).names
        : []
    return new Set(names.filter((entry): entry is string => typeof entry === 'string'))
  } catch {
    // Malformed sidecar is treated as empty. Suppression is best-effort.
    return new Set()
  }
}

/**
 * Plain wholesale write of the suppression sidecar (tests and fixture seeding).
 * @internal S2.4 (PLAN 2026-09-16, audit P2-31): NO production consumer
 * (verified by grep; production suppressions go through
 * {@link updateSuppressedNames}) — exported for the family's tests only. Do
 * not use it to write the sidecar in new code.
 *
 * The write rides the {@link transactIo} channel (the same lock the RMW
 * writer uses), not the former naked read → `io.writeText`: that form was an
 * unserialized read-modify-write — the last `saveSuppressedNames` in this file
 * with no lock, while its sibling `saveUsage` already carried the `@internal`
 * test-only note. Version discipline is unchanged (V24-09 / S2-14): a read
 * failure surfaces (an unreadable sidecar is never written over), a newer
 * on-disk schema is warned about and preserved byte-for-byte (the
 * byte-identical result short-circuits the write), and a malformed sidecar is
 * still overwritten with the v1 shape (the historical plain-writer posture).
 */
export async function saveSuppressedNames(
  root: string,
  names: ReadonlySet<string>,
  io: EvolutionIoLike = nodeEvolutionIo(),
): Promise<void> {
  await transactIo(io, suppressedFile(root), (current) => {
    // V24-09 (v24): same future-version discipline as the RMW path below and
    // the mutations/usage/events writers (A2-11 / L-1 / F-338) — a newer
    // on-disk schema is never downgraded by this writer.
    // S2-14 (root cause B): and neither is one this writer could not READ. The
    // former `.catch(() => null)` folded a read failure (EACCES/EIO/EISDIR —
    // `readText` answers null only for a MISSING path) into "no sidecar", skipped
    // the version guard and overwrote it: the one fold in this file that permitted
    // a downgrade. The failure now surfaces to the caller.
    if (current !== null) {
      try {
        const parsed = JSON.parse(current) as { version?: unknown } | null
        if (parsed !== null && typeof parsed.version === 'number' && parsed.version > SUPPRESSED_FILE_VERSION) {
          console.warn(`suppression sidecar ${suppressedFile(root)} declares version ${String(parsed.version)} (newer than ${SUPPRESSED_FILE_VERSION}); not overwritten`)
          // Byte-identical result → transactIo/io.transact skip the write.
          return current
        }
      } catch {
        // Malformed — the plain write below matches the historical behavior.
      }
    }
    return JSON.stringify({ version: SUPPRESSED_FILE_VERSION, names: [...names].sort() }, null, 2)
  })
}

/**
 * Atomic read-modify-write on the suppression sidecar (rc.50 P2-2): `task`
 * receives the set parsed from the current on-disk state and may mutate it;
 * the result is persisted inside the same transact so a second process
 * sharing DSH_HOME cannot interleave its RMW. Best-effort posture unchanged.
 */
export async function updateSuppressedNames(
  root: string,
  io: EvolutionIoLike,
  task: (names: Set<string>) => void | Promise<void>,
): Promise<void> {
  await transactIo(io, suppressedFile(root), async (current) => {
    // P3: never overwrite a malformed suppression sidecar; V24-09 (v24): a
    // newer on-disk version is never downgraded by this writer — the family
    // discipline the mutations (A2-11), usage (L-1) and evolution-events
    // (F-338) writers already follow. parseSuppressed below deliberately
    // ignores `version`; this guard reads it directly so an unknown future
    // shape (carrying fields this runtime does not know) keeps its bytes
    // instead of being rewritten back to the v1 shape.
    if (current !== null) {
      let parsed: { version?: unknown } | null = null
      try {
        parsed = JSON.parse(current) as { version?: unknown } | null
      } catch {
        return current
      }
      if (parsed !== null && typeof parsed.version === 'number' && parsed.version > SUPPRESSED_FILE_VERSION) {
        console.warn(`suppression sidecar ${suppressedFile(root)} declares version ${String(parsed.version)} (newer than ${SUPPRESSED_FILE_VERSION}); not overwritten`)
        return current
      }
    }
    const names = parseSuppressed(current)
    await task(names)
    return JSON.stringify({ version: SUPPRESSED_FILE_VERSION, names: [...names].sort() }, null, 2)
  })
}
