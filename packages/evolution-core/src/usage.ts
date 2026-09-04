/**
 * Skill usage telemetry sidecar: `$DSH_HOME/skills/.usage.json`.
 * Format-compatible with Hermes Agent / hermes-claw core fields.
 */

import { join } from 'node:path'
import { nodeEvolutionIo, transactIo, type EvolutionIoLike } from './io.ts'

export type SkillState = 'active' | 'stale' | 'archived'

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
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback
  return {
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
  }
}

/** Parse a raw usage sidecar; malformed content reads as empty (best-effort telemetry). */
function parseUsage(raw: string | null): UsageMap {
  const map: UsageMap = new Map()
  if (raw === null) return map
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const [name, record] of Object.entries(parsed)) {
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
export async function mutateUsage(root: string, io: EvolutionIoLike, task: (map: UsageMap) => void | Promise<void>): Promise<void> {
  await transactIo(io, usageFile(root), async (current) => {
    // P3 (v3 audit): a malformed sidecar is never overwritten by the RMW —
    // JSON.parse swallow→empty then persist would destroy recoverable telemetry.
    if (current !== null) {
      try { JSON.parse(current) } catch { return current }
    }
    const map = parseUsage(current)
    await task(map)
    return JSON.stringify(Object.fromEntries(map.entries()), null, 2)
  })
}

/**
 * Curator-owned usage fields (rc.67 K-2): the curator writes ONLY this set —
 * lifecycle state, archive stamp, the six-factor quality pair, and the
 * marker-mirrored pin flag. Counter and activity-stamp fields belong to the
 * tool-telemetry side (skill-usage / tool-skill-manage), which bumps them
 * through its own transact-backed RMW. A whole-record overwrite by either
 * side would clobber the other side's concurrent increment, so cross-side
 * folds copy this set only.
 */
export function applyCuratorFields(disk: UsageRecord, curated: UsageRecord): void {
  applyCuratorMetaFields(disk, curated)
  applyCuratorLifecycleFields(disk, curated)
}

/** Copy only the lifecycle pair (state/archived_at) — see the ownership split
 * rationale on {@link applyCuratorMetaFields}. */
export function applyCuratorLifecycleFields(disk: UsageRecord, curated: UsageRecord): void {
  disk.state = curated.state
  disk.archived_at = curated.archived_at
}

/**
 * Copy the recomputed meta pair (quality_score/quality_warn + the
 * marker-mirrored pin flag) — refreshed tree-wide each run by design, so a
 * concurrent curator run's lifecycle changes are never reverted by them.
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
export function foldCuratorFields(disk: UsageMap, curated: UsageMap, stateOwned?: ReadonlySet<string>): void {
  for (const [name, record] of curated) {
    const diskRecord = disk.get(name)
    if (!diskRecord) {
      disk.set(name, { ...record })
      continue
    }
    applyCuratorMetaFields(diskRecord, record)
    if (stateOwned === undefined || stateOwned.has(name)) applyCuratorLifecycleFields(diskRecord, record)
  }
}

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

export async function saveSuppressedNames(
  root: string,
  names: ReadonlySet<string>,
  io: EvolutionIoLike = nodeEvolutionIo(),
): Promise<void> {
  await io.writeText(suppressedFile(root), JSON.stringify({ version: SUPPRESSED_FILE_VERSION, names: [...names].sort() }, null, 2))
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
    // P3: never overwrite a malformed suppression sidecar.
    if (current !== null) {
      try { JSON.parse(current) } catch { return current }
    }
    const names = parseSuppressed(current)
    await task(names)
    return JSON.stringify({ version: SUPPRESSED_FILE_VERSION, names: [...names].sort() }, null, 2)
  })
}
