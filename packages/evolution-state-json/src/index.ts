/**
 * JSON-file evolution state provider over the IO seam.
 *
 * This is the portable provider: `ctx.evolutionIo` may be node:fs today and a
 * network/shared medium tomorrow without any state-format changes.
 * @module @deepseek-ai/dsh-evolution-state-json
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { evolutionHome, makeSerialQueue, transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import {
  canClaimPending,
  canResolvePending,
  releasedStatus,
  CURATOR_STATE_FILE,
  CURATOR_STATE_KEY,
  PENDING_ARCHIVE_BAK_FILE,
  PENDING_ARCHIVE_FILE,
  PENDING_LEGACY_FILE,
  PENDING_STATE_FILE,
  PROVIDER_JSON,
  REVIEW_STATE_FILE,
  type CuratorStateRecord,
  type EvolutionStateStorage,
  type PendingRecord,
  type PendingResolution,
  type PendingStatus,
  type ReviewStateRecord,
} from '@deepseek-ai/dsh-evolution-state-storage'
import { isAbsolute, join } from 'node:path'

export const name = 'evolution-state-json'
export const inject = ['evolutionStateStorage', 'evolutionIo']

export interface Config {
  root?: string
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
})

// 0.3.19 (W1.3): the home path resolves via core evolutionHome() (single
// source; also uses `||` so an EMPTY DSH_HOME falls back — the local
// defaultRoot used `??` and inherited the E-74 empty-string hole).
// 0.3.27 (V4-09): the config root is trimmed like resolveSkillsRoot so a
// whitespace-only `root` (' ') is not truthy and does not resolve to a
// CWD-relative path — empty or whitespace both fall through to evolutionHome().

/** 0.3.22 (F-336): resolved (approved/rejected) audit records are capped in
 * the LIVE pending map so a long-running deployment never grows it without
 * bound; the oldest over the cap are archived (made package-private so the
 * archive sidecar and the provider enforce one number). */
const PENDING_RESOLVED_CAP = 200

/** 0.3.27 (V4-01): the audit sidecar (pending-state-archive.json) is bounded
 * at this many resolved records. Past it the oldest history rotates to a
 * `.bak` sidecar, so the file — and the full-array rewrite on every append —
 * never grows without bound. */
const ARCHIVE_RESOLVED_CAP = 5000

/** 0.3.27 (V4-01): an archive entry's dedupe identity. The same audit record
 * (id + status + resolvedAt) must never appear twice; the read-only legacy
 * `pending.json` merge used to re-introduce an evicted record on the next
 * resolve and archive it again, growing the sidecar without bound. */
const pendingArchiveKey = (record: PendingRecord): string =>
  `${record.id}\u0000${record.status}\u0000${record.resolvedAt ?? ''}`

/** 0.3.22 (F-215): a record-map state file must parse to a non-null plain
 * object (a map of records) — valid JSON that is `null`/array/scalar is a
 * corrupt map that used to read as "empty" and was silently overwritten by
 * the next save. Only these four files are record maps; the archive sidecar
 * is a top-level ARRAY and must NOT be gated by this predicate. */
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const RECORD_MAP_FILES = new Set([REVIEW_STATE_FILE, CURATOR_STATE_FILE, PENDING_STATE_FILE, PENDING_LEGACY_FILE])

/** V10-05 (P2-5): discriminant stamped on every quarantine error so
 * best-effort wrappers (retireLegacyOnce) can tell "corrupt state — fail
 * loud" from a transient IO failure and let the quarantine propagate. */
const QUARANTINE_ERROR_NAME = 'EvolutionStateCorruptFile'

/** 0.3.17 (E-9): a malformed state file used to parse to `null` and was then
 * OVERWRITTEN by the next save — every other session's review state / the
 * whole pending table vanished silently. Fail loud instead: preserve the
 * original bytes beside it and throw, so the operator can rescue and the
 * corruption is never accepted as "empty".
 * V10-05 (P2-5): the copy is the FIXED name `<file>.corrupt`, written through
 * the IO seam's atomic write (tmp+rename under the node backend), so it
 * overwrite-commits — at most ONE preserved copy per file can ever
 * accumulate. The old `.corrupt-<stamp>-<rand>` name minted a fresh file on
 * EVERY read of a corrupt file: unbounded growth with no sweep. The fixed
 * copy is swept after 7 days by the node backend's sweepStaleTmps (S-10). */
async function quarantine(io: () => EvolutionIoLike, root: string, file: string, raw: string, reason: string): Promise<never> {
  const dest = `${join(root, file)}.corrupt`
  // P2-27 (v11): a failed rescue copy must not claim "original preserved" —
  // the operator follows the message to a file that does not exist. The main
  // failure stays fail-loud either way; only the diagnosis gets honest.
  let preservedNote = `; original preserved at ${dest} — inspect and fix it, then retry.`
  try {
    await io().writeText(dest, raw)
  } catch (writeError) {
    preservedNote = `; the quarantine copy at ${dest} FAILED to write (${writeError instanceof Error ? writeError.message : String(writeError)}) — the original file is left in place.`
  }
  throw Object.assign(
    new Error(`evolution state file "${file}" is not valid JSON (${reason})${preservedNote}`),
    { name: QUARANTINE_ERROR_NAME },
  )
}

/** S-05: the V8-16 record-shape gate existed as two verbatim ~15-line
 * copies (jsonTransact + readJson); this private helper is the single owner.
 * Returns the quarantine reason for the first non-plain-object record value,
 * or null when every value of the map is a plain object. */
function firstNonRecordValue(parsed: unknown): string | null {
  if (!isPlainRecord(parsed)) return null
  for (const [recordId, record] of Object.entries(parsed)) {
    if (!isPlainRecord(record)) {
      return `expected a plain object for record "${recordId}", got ${record === null ? 'null' : Array.isArray(record) ? 'an array' : typeof record}`
    }
  }
  return null
}

// V10-04 (P2-19): per-record FIELD gates. The JSON provider had no record
// schema, so `{"s1":{"foo":1}}` loaded as a ReviewStateRecord and
// `turnsSinceMemory` became NaN in the review math; a non-enum `status` value
// ("Pending") became a permanent zombie no query could see. The domain
// provider zod-parses every record at open — the json provider now matches
// that strictness in pure TS (~40 lines): no zod here, and NO import from
// state-domain (provider packages must not depend on each other; the seam
// stays symmetric). A record failing its gate is quarantined to the same
// fixed `<file>.corrupt` copy (V10-05) and EXCLUDED from the result —
// isolated, never a silent pass-through, and always a visible rescue target.
const isNonNegInt = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'
const PENDING_KINDS = new Set(['memory', 'skill', 'capability'])
const PENDING_STATUSES = new Set(['pending', 'executing', 'approved', 'rejected'])

const gateReviewRecord = (record: Record<string, unknown>): boolean =>
  isNonNegInt(record.turnsSinceMemory) && isNonNegInt(record.turnsSinceSkill) && isNonNegInt(record.lastTurn)

const gateCuratorRecord = (record: Record<string, unknown>): boolean =>
  typeof record.lastRunAt === 'number' && Number.isFinite(record.lastRunAt) && record.lastRunAt >= 0
  && isNonNegInt(record.runCount)
  && typeof record.lastSummary === 'string'
  && typeof record.paused === 'boolean'

const gatePendingRecord = (record: Record<string, unknown>): boolean =>
  typeof record.id === 'string'
  && typeof record.kind === 'string' && PENDING_KINDS.has(record.kind)
  && typeof record.summary === 'string'
  && typeof record.createdAt === 'string'
  && typeof record.status === 'string' && PENDING_STATUSES.has(record.status)
  && optionalString(record.resolvedAt) && optionalString(record.claimedBy)
  && optionalString(record.claimedAt) && optionalString(record.origin)
  && optionalString(record.sessionId)

const RECORD_FIELD_GATES: Record<string, (record: Record<string, unknown>) => boolean> = {
  [REVIEW_STATE_FILE]: gateReviewRecord,
  [CURATOR_STATE_FILE]: gateCuratorRecord,
  [PENDING_STATE_FILE]: gatePendingRecord,
  [PENDING_LEGACY_FILE]: gatePendingRecord,
}

/** V11-B1 (P2-23): shared per-record field-gate scan for BOTH paths (readJson
 * + jsonTransact — the transaction baseline used to skip the field gates, so
 * a string `runCount` became `"x1"` through `(current?.runCount ?? 0) + 1` at
 * the next save). Returns the failing [id, record] entries; empty when the
 * file has no gate, the value is not a plain map, or everything passes. */
function gateScan(file: string, parsed: unknown): Array<[string, unknown]> {
  const gate = RECORD_FIELD_GATES[file]
  if (gate === undefined || !isPlainRecord(parsed)) return []
  return Object.entries(parsed).filter(([, record]) => !isPlainRecord(record) || !gate(record))
}

/**
 * Cross-process JSON-file RMW (v3-audit M-8): every read-modify-write state
 * mutation runs inside the IO backend's transact lock (via transactIo) so a
 * second process sharing DSH_HOME cannot interleave its claim/resolve.
 * `task` returns the next value; null = ENSURE-ABSENT (the file is deleted
 * when it exists — the parity of the transact seam, V6-32). For a record-map
 * file the return must be null or a plain object map of records, and an
 * array/scalar would be persisted as a corrupt map — so it fails loud before
 * any write (0.3.28, V4-08). The legacy `pending.json` merge stays inside the
 * task via `readJson` where relevant.
 * @internal Exported only for this package's own tests — not public API
 * surface (audit v10 S-03); other packages must go through the provider seam.
 */
// V10-04 (P2-19): the record-gate warn fires once per file per process — a
// permanently bad record would otherwise warn on every turn's read. Module
// scope: readJson (apply closure) and jsonTransact (module function) share it.
const recordGateWarned = new Set<string>()
// P2-24 (v11): the last `.corrupt` rewrite key per file (sorted failing id
// set) — skip rewriting when nothing changed, so a permanently bad record
// never re-atomic-writes the copy on every read.
const corruptWritten = new Map<string, string>()
// N2/N3/N12 (v12): shared quarantine machinery for the READ path and the
// TRANSACT baseline — the bad-record warn fires once per file per process
// whichever path hit it first; the rewrite key is set ONLY after a
// successful write (a failed write is retried, not marked done); and the
// key alone is not trusted — a copy swept by the 7-day stale cleanup (S-10)
// is rebuilt on the next access instead of being skipped until restart.
const corruptWriteWarned = new Set<string>()

function reportGateViolation(ctx: Context, file: string, failing: Array<[string, unknown]>): void {
  if (recordGateWarned.has(file)) return
  recordGateWarned.add(file)
  ctx.logger.warn(`evolution-state-json: ${failing.length} record(s) in "${file}" failed the record schema gate and were quarantined to "${file}.corrupt": ${failing.map(([id]) => id).join(', ')}`)
}

async function ensureCorruptCopy(
  ctx: Context,
  io: () => EvolutionIoLike,
  root: string,
  file: string,
  bad: Record<string, unknown>,
): Promise<void> {
  const corruptPath = `${join(root, file)}.corrupt`
  const corruptKey = JSON.stringify(Object.keys(bad).sort())
  if (corruptWritten.get(file) === corruptKey && await io().exists(corruptPath)) return
  const wrote = await io().writeText(corruptPath, JSON.stringify(bad, null, 2)).then(() => true).catch(() => false)
  if (wrote) {
    corruptWritten.set(file, corruptKey)
    corruptWriteWarned.delete(file)
  } else if (!corruptWriteWarned.has(file)) {
    corruptWriteWarned.add(file)
    ctx.logger.warn(`evolution-state-json: could not write quarantine copy "${corruptPath}" for ${Object.keys(bad).length} failed record(s) — the main file keeps them; the copy is retried on the next access`)
  }
}

export async function jsonTransact<T>(
  ctx: Context,
  io: () => EvolutionIoLike,
  root: string,
  file: string,
  task: (current: T | null) => T | null | Promise<T | null>,
): Promise<void> {
  await transactIo(io(), join(root, file), async (current) => {
    let parsed: T | null = null
    if (current !== null) {
      try {
        parsed = JSON.parse(current) as T
      } catch (error) {
        return await quarantine(io, root, file, current, error instanceof Error ? error.message : String(error))
      }
      // 0.3.27 (V4-06): outside the parse try — a wrong-shape quarantine must
      // not fall into the catch and quarantine a second time.
      if (RECORD_MAP_FILES.has(file) && !isPlainRecord(parsed)) {
        const kind = Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed
        return await quarantine(io, root, file, current, `expected a plain JSON object (map of records), got ${kind}`)
      }
      // V8-16 (0.3.46): the top-level shape gate let VALUE-level malformations
      // (`{"a": null}`) through — listPending/enforceResolvedCap then hit a
      // bare `.status` TypeError with no quarantine / no preserving failure
      // context. Every record value of a record-map file must itself be a
      // plain object; anything else quarantines (original bytes preserved).
      // S-05: the gate now lives in ONE helper shared with the read
      // path (it was ~15 lines duplicated verbatim in this file).
      const malformed = firstNonRecordValue(parsed)
      if (malformed !== null) return await quarantine(io, root, file, current, malformed)
      // V11-B1 (P2-23): the transaction baseline must pass the SAME per-record
      // field gate as the read path — a bad primary (string runCount etc.)
      // used to reach the task and pollute the write-back ("x1"). Bad records
      // go to the fixed `<file>.corrupt` copy; the task sees the sanitized map.
      const failing = gateScan(file, parsed)
      if (failing.length > 0) {
        const bad: Record<string, unknown> = {}
        const good: Record<string, unknown> = {}
        for (const [id, record] of Object.entries(parsed as Record<string, unknown>)) {
          if (failing.some(([failedId]) => failedId === id)) bad[id] = record
          else good[id] = record
        }
        // N3 (v12): the transact baseline previously dropped bad records and
        // wrote .corrupt with zero observable trace — same warn/rewrite
        // discipline as the read path now applies (deduped per file).
        reportGateViolation(ctx, file, failing)
        await ensureCorruptCopy(ctx, io, root, file, bad)
        parsed = good as T
      }
    }
    const next = await task(parsed)
    // 0.3.28 (V4-08): a record-map task's return must be null (ensure-absent —
    // the file is deleted when it exists) or a plain object map of records — an
    // array/scalar would be stringified and persisted as a corrupt record map.
    // Fail loud before any write.
    if (next !== null && RECORD_MAP_FILES.has(file) && !isPlainRecord(next)) {
      const kind = Array.isArray(next) ? 'an array' : typeof next
      throw new Error(`evolution state file "${file}" task returned ${kind} (expected null or a plain JSON object map of records); not written.`)
    }
    return next === null ? null : JSON.stringify(next, null, 2)
  })
}

export function apply(ctx: Context, rawConfig: Config): void {
  const root = (rawConfig.root ?? '').trim() || evolutionHome()
  // S-08: an explicit RELATIVE config.root resolves against the
  // process CWD, so two launch modes read two different stores. The
  // resolution itself is kept (anchoring it is a behavior change deliberately
  // NOT made — audit v10 S-08 records the open question); this one-time warn
  // only makes the hazard observable.
  if (rawConfig.root !== undefined && rawConfig.root.trim() !== '' && !isAbsolute(rawConfig.root)) {
    ctx.logger.warn(`evolution-state-json: config.root "${rawConfig.root}" is a relative path and resolves against the process CWD ("${root}") — pass an absolute path to make the store location launch-independent`)
  }
  const io = () => ctx.evolutionIo.provider()
  const pathOf = (file: string) => join(root, file)
  // The shared quarantine machinery lives at module scope (see above): the
  // transact baseline runs inside jsonTransact, a module-level wrapper that
  // cannot reach apply-scoped closures.

  async function readJson<T>(file: string): Promise<T | null> {
    const raw = await io().readText(pathOf(file))
    if (raw === null) return null
    let parsed: T
    try {
      parsed = JSON.parse(raw) as T
    } catch (error) {
      return await quarantine(io, root, file, raw, error instanceof Error ? error.message : String(error))
    }
    // 0.3.22 (F-215): a valid JSON that is the wrong top-level shape is a
    // corrupt record map, not "empty" — fail loud so the operator notices
    // instead of the next save silently wiping every other record.
    // 0.3.27 (V4-06): this check lives OUTSIDE the parse try, so a wrong-shape
    // quarantine (which throws) does not fall into the catch above and
    // quarantine the file a SECOND time (two `.corrupt-*` copies per read).
    if (RECORD_MAP_FILES.has(file) && !isPlainRecord(parsed)) {
      const kind = Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed
      return await quarantine(io, root, file, raw, `expected a plain JSON object (map of records), got ${kind}`)
    }
    // V8-16 (0.3.46): same value-level gate as jsonTransact — the read path
    // (listPending / loadPendingMap) used to pass `{"a": null}` through and
    // then hit a bare `.status` TypeError with no quarantine context.
    // S-05: single-sourced via firstNonRecordValue.
    const malformed = firstNonRecordValue(parsed)
    if (malformed !== null) return await quarantine(io, root, file, raw, malformed)
    // V11-B1: single-sourced via gateScan (readJson + jsonTransact share it).
    const failing = gateScan(file, parsed)
    if (failing.length > 0) {
      const bad: Record<string, unknown> = {}
      const good: Record<string, unknown> = {}
      for (const [id, record] of Object.entries(parsed as Record<string, unknown>)) {
        if (failing.some(([failedId]) => failedId === id)) bad[id] = record
        else good[id] = record
      }
      // P2-24 (v11): rewrite the .corrupt copy only when the failing set CHANGED
      // — a permanently bad record otherwise re-atomic-writes it on every read
      // (write amplification + an mtime touch that defeats the 7-day sweep in a
      // long-running process). N2/N12 (v12): the shared helper additionally
      // rebuilds a copy the sweep already removed and does not mark a failed
      // write as done.
      reportGateViolation(ctx, file, failing)
      await ensureCorruptCopy(ctx, io, root, file, bad)
      return good as T
    }
    return parsed
  }

  // All JSON-file state mutations share one queue: each read-modify-write is
  // a single task, so concurrent review/curator/approval writers can never
  // overwrite each other's newest record in THIS process. The transact lock
  // (jsonTransact) covers OTHER processes; this chain is the second layer.
  // 0.3.17 (S2.8, T-1): the queue factory is shared with memory-files now.
  const mutate = makeSerialQueue()

  // `pending.json` is the pre-split approval store name. Reads MERGE both
  // files and the new `pending-state.json` wins on id conflicts, so creating
  // a new pending record can never hide legacy records still awaiting
  // approval. Mutations write back to `pending-state.json`; a resolved or
  // deleted record therefore overrides the legacy copy on the next read.
  // 0.3.29 (V5-02): the legacy copy is RETIRED once — merged into current and
  // renamed aside — so a cap-rotated resolved record can never re-expose its
  // stale `status:'pending'` legacy twin and get re-claimed + replayed (the
  // approval runner replays the months-old staged args). Retirement runs on
  // the read path (listPending), where no jsonTransact is already held; the
  // in-memory flag stops per-call churn, and any failure (IO/rename) leaves
  // the flag unset so the next safe point retries (the merge is idempotent —
  // the same combined map every time).
  // 0.3.34 (V6-01): the same filtering applies to the FOUR mutation paths'
  // inner merges — a mutation that runs before any list would otherwise
  // merge the RAW legacy (no archive exclusion) and fixate a ghost twin in
  // current where retirement can never remove it (id-in-current skip).
  // The archive id set is read once and cached: it only strengthens the
  // filter, and any stale-miss is covered by the current-wins half of the
  // exclusion (the id was in current at the time it was archived before it
  // could be rotated out).
  let legacyMigrated = false
  async function readArchivedIds(): Promise<Set<string>> {
    // V11-B2 (P1-9): NO process-level cache — the archive set is only read on
    // the legacy-merge paths (low frequency), and a stale set across processes
    // re-opened the V5-02 ghost-twin window (a cap-rotated id excluded from a
    // cached set could be merged back in and RE-CLAIMED). Every call re-reads
    // both sidecars; two reads per merge is an acceptable cost.
    const ids = new Set<string>()
    try {
      const rawArchive = await readJson<Array<{ id?: string } | null>>(PENDING_ARCHIVE_FILE)
      if (Array.isArray(rawArchive)) {
        for (const entry of rawArchive) if (entry && typeof entry.id === 'string') ids.add(entry.id)
      }
      // V6-31 (0.3.37): after a rotation the older archive entries live in the
      // .bak — read it too, so an archived id evicted to the bak keeps
      // excluding its legacy twin (the retirement filter never loses its
      // evidence). Best-effort: an unreadable bak only weakens the filter.
      try {
        const rawBak = await readJson<Array<{ id?: string } | null>>(PENDING_ARCHIVE_BAK_FILE)
        if (Array.isArray(rawBak)) {
          for (const entry of rawBak) if (entry && typeof entry.id === 'string') ids.add(entry.id)
        }
      } catch {
        // Unreadable bak — the active archive still carries the newer ids.
      }
    } catch {
      // Corrupt/unreadable archive — best-effort: keep legacy copies (the
      // previous merge behavior) rather than dropping possibly-real work.
    }
    return ids
  }
  function filterLegacy(
    legacy: Record<string, PendingRecord>,
    current: Record<string, PendingRecord> | null,
    archivedIds: Set<string>,
  ): Record<string, PendingRecord> {
    // V5-02: legacy copies of records the archive already saw are COMPLETED
    // history — a stale `status:'pending'` twin must never be resurrected
    // (the cap rotation may already have evicted the resolved twin from
    // current, and a plain merge would fixate the pending copy). current
    // wins for shared ids; legacy-only ids survive only when the archive has
    // never seen them (genuinely unresolved work).
    const retired: Record<string, PendingRecord> = {}
    for (const [id, record] of Object.entries(legacy)) {
      if (id in (current ?? {})) continue
      if (archivedIds.has(id)) continue
      retired[id] = record
    }
    return retired
  }
  async function retireLegacyOnce(
    legacy: Record<string, PendingRecord>,
    current: Record<string, PendingRecord> | null,
  ): Promise<Record<string, PendingRecord>> {
    if (legacyMigrated) return {}
    try {
      const archivedIds = await readArchivedIds()
      const retired = filterLegacy(legacy, current, archivedIds)
      // V6-02 (0.3.34): the transact task takes the lock-INSIDE re-read as its
      // argument — a closure over the pre-lock snapshot could overwrite a
      // concurrent writer's newer state between the probe and the lock (Y
      // staged → vanished, or X approved → reverted to pending → replayable).
      await jsonTransact(ctx, io, root, PENDING_STATE_FILE, fresh => ({ ...retired, ...(fresh ?? {}) }))
      await io().rename(pathOf(PENDING_LEGACY_FILE), `${pathOf(PENDING_LEGACY_FILE)}.migrated`)
      legacyMigrated = true
      return retired
    } catch (error) {
      // V10-05 (P2-5): a quarantine/Isolation error is NOT swallowed — the
      // bare catch used to turn a corrupt state file into a silent
      // legacy-only view (fail-loud E-9 degraded behind the best-effort
      // wrapper). Quarantine errors are discriminated by their error name
      // (set in quarantine below); everything else keeps the best-effort
      // retirement semantics (the file simply stays until a later safe
      // point) but now warns instead of vanishing without a trace.
      if (error instanceof Error && error.name === QUARANTINE_ERROR_NAME) throw error
      ctx.logger.warn(`evolution-state-json: legacy pending retirement deferred: ${error instanceof Error ? error.message : String(error)}`)
      // P2-26 (v11): the old catch returned the WHOLE legacy map — archived
      // ghost twins escaped into the read view ("visible but never claimable"
      // zombies). A deferred retirement must NOT free the unfiltered legacy:
      // the view falls back to current-only (the legacy file stays on disk and
      // the next safe point retries).
      return {}
    }
  }
  async function loadPendingMap(): Promise<Record<string, PendingRecord>> {
    const [current, legacy] = await Promise.all([
      readJson<Record<string, PendingRecord>>(PENDING_STATE_FILE),
      readJson<Record<string, PendingRecord>>(PENDING_LEGACY_FILE),
    ])
    if (legacy !== null) {
      const retired = await retireLegacyOnce(legacy, current)
      return { ...retired, ...(current ?? {}) }
    }
    return { ...(current ?? {}) }
  }
  /** V6-01 (0.3.34): single-sourced legacy merge for the four mutation paths —
   * the SAME exclusion as the retirement read path, so a mutation that runs
   * before any retirement cannot fixate a ghost pending twin in current
   * (the archive id set is cached once; current-wins covers stale misses). */
  async function mergedWithFilteredLegacy(
    legacy: Record<string, PendingRecord> | null,
    current: Record<string, PendingRecord>,
  ): Promise<Record<string, PendingRecord>> {
    if (legacy === null) return current
    const archivedIds = await readArchivedIds()
    return { ...filterLegacy(legacy, current, archivedIds), ...current }
  }

  /** 0.3.22 (F-336): when the live pending map holds more than
   * `PENDING_RESOLVED_CAP` resolved records, drop the oldest (by resolvedAt,
   * then insertion order on ties) from the map and return them for archiving.
   * Only approved/rejected records are candidates — pending/executing are
   * live work and are never trimmed. Returns the pruned map (rather than
   * mutating in place) plus the evicted records. */
  function enforceResolvedCap(map: Record<string, PendingRecord>): { map: Record<string, PendingRecord>; evicted: PendingRecord[] } {
    const resolved = Object.values(map).filter(record => record.status === 'approved' || record.status === 'rejected')
    if (resolved.length <= PENDING_RESOLVED_CAP) return { map, evicted: [] }
    const overflow = resolved.length - PENDING_RESOLVED_CAP
    // V5-09 (0.3.29): an unparseable resolvedAt sorts as "oldest-unknown" (same
    // as a missing one) instead of poisoning the sort with NaN; eviction is by
    // record id — a hand-edited file whose key ≠ id must still leave the map
    // (the old key-based filter archived the record but never evicted it).
    const entryTime = (record: PendingRecord): number => {
      if (!record.resolvedAt) return Number.MAX_SAFE_INTEGER
      const parsed = Date.parse(record.resolvedAt)
      return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
    }
    const oldest = resolved
      .sort((a, b) => entryTime(a) - entryTime(b))
      .slice(0, overflow)
    // V6-30 (0.3.37): eviction is by the map KEY of the oldest ENTRIES, not by
    // their id — a hand-edited file with two entries sharing one id would
    // evict BOTH keys while archiving only one (over-eviction + a missing
    // archive line). Exactly the chosen entries leave, each archived once.
    const oldestKeys = new Set<string>()
    for (const [key, value] of Object.entries(map)) {
      if (oldest.includes(value)) oldestKeys.add(key)
    }
    const kept: Record<string, PendingRecord> = {}
    for (const [key, value] of Object.entries(map)) {
      if (!oldestKeys.has(key)) kept[key] = value
    }
    return { map: kept, evicted: oldest }
  }

  /** 0.3.22 (F-336): append evicted resolved records to an audit sidecar
   * (top-level array, oldest-first). This is a best-effort audit aid: a
   * corrupt/unreadable archive is skipped and an archive write failure must
   * NEVER fail the resolve that triggered it — the live map is already
   * trimmed, so the audit copy is allowed to fall behind.
   * 0.3.27 (V4-01): dedupe by id+status+resolvedAt before appending (the
   * read-only legacy `pending.json` re-introduces an evicted record on the
   * next resolve) and rotate the sidecar to `.bak` past ARCHIVE_RESOLVED_CAP
   * so neither the file nor the per-append full-array rewrite grows without
   * bound. */
  async function appendArchive(records: PendingRecord[]): Promise<void> {
    try {
      await transactIo(io(), pathOf(PENDING_ARCHIVE_FILE), async (current) => {
        // P2-25 (v11): the archive arrives from disk — keep the type honest as
        // (PendingRecord | null)[] so the non-object guard below is meaningful
        // (a null entry used to TypeError inside pendingArchiveKey).
        let archive: Array<PendingRecord | null> = []
        if (current !== null) {
          try {
            const parsed = JSON.parse(current) as unknown
            if (Array.isArray(parsed)) archive = parsed as Array<PendingRecord | null>
          } catch {
            // unrecoverable archive — best-effort: start fresh
          }
        }
        // V5-07 (0.3.33): archives written before the dedupe key existed may
        // carry duplicate entries (same id+status+resolvedAt) that counted
        // toward the cap forever — collapse them on load (first occurrence
        // wins, best-effort; the .bak may still hold them, audit is allowed
        // to fall behind). P2-25 (v11): non-object entries are dropped FIRST —
        // pendingArchiveKey would TypeError on a null entry and the outer
        // catch silently killed the whole audit sidecar.
        const shaped = archive.filter((entry): entry is PendingRecord => entry !== null && typeof entry === 'object')
        const archiveKeys = new Set<string>()
        const collapsed = shaped.filter((entry) => {
          const key = pendingArchiveKey(entry)
          if (archiveKeys.has(key)) return false
          archiveKeys.add(key)
          return true
        })
        // V6-22 (0.3.37): when the load COLLAPSED duplicates, the disk must be
        // rewritten even with no fresh record — a parse-time collapse that
        // never lands left the duplicates on disk forever (each round folded
        // them in memory, the cap accounting was correct, the residue wasn't).
        const hadDuplicates = collapsed.length !== archive.length
        archive = collapsed
        const seen = new Set(collapsed.map(pendingArchiveKey))
        const fresh = records.filter(record => !seen.has(pendingArchiveKey(record)))
        if (fresh.length === 0 && !hadDuplicates) return current
        const next = [...archive, ...fresh]
        if (next.length > ARCHIVE_RESOLVED_CAP) {
          // Rotate the full pre-rotation history to a `.bak` sidecar and restart
          // the active sidecar from the batch that overflowed it (log-rotation
          // style), so the file and its rewrite are bounded. Best-effort: a
          // failed rotate only loses the rotated audit copy. V5-10 (0.3.29): an
          // empty archive is not rotated into a `[]` bak, and a single huge
          // batch keeps only the newest CAP entries (the oldest of the batch
          // are dropped — best-effort audit, the live map already fell behind
          // first, and the legacy-retirement of V5-02 removed the cross-
          // generation re-archive driver). V6-22 (0.3.37) delta fix: a
          // FRESH-EMPTY rotation (collapse-only pass over an over-cap residue)
          // must keep the newest CAP of the COLLAPSED history — writing
          // fresh.slice() (an empty batch) would blank the audit sidecar.
          if (archive.length > 0) {
            await io().writeText(pathOf(PENDING_ARCHIVE_BAK_FILE), JSON.stringify(archive, null, 2)).catch(() => {})
          }
          // V7-08 (0.3.44) + V11-B2 (P1-9): the rotation moved ids into/out of
          // the active archive — readArchivedIds now reads fresh on every call
          // (no cache to invalidate), so the exclusion can never be stale.
          return JSON.stringify((fresh.length > 0 ? fresh : next).slice(-ARCHIVE_RESOLVED_CAP), null, 2)
        }
        // V7-08 (0.3.44) + V11-B2: plain appends add ids—re-read covers them.
        return JSON.stringify(next, null, 2)
      })
    } catch (error) {
      // Audit aid only: never let an archive write failure surface as a
      // resolve failure. P2-25 (v11): E-52 discipline — the swallow must be
      // observable, or a poisoned archive sidecar dies silently.
      ctx.logger.warn(`evolution-state-json: archive append deferred: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const provider: EvolutionStateStorage = {
    name: PROVIDER_JSON,

    async loadReviewState(sessionId) {
      return await mutate(async () => {
        const map = await readJson<Record<string, ReviewStateRecord>>(REVIEW_STATE_FILE)
        return map?.[sessionId] ?? null
      })
    },

    async saveReviewState(sessionId, record) {
      await mutate(async () => {
        await jsonTransact<Record<string, ReviewStateRecord>>(
          ctx, io, root, REVIEW_STATE_FILE,
          current => ({ ...(current ?? {}), [sessionId]: record }),
        )
      })
    },

    async loadCuratorState() {
      return await mutate(async () => {
        const map = await readJson<Record<string, CuratorStateRecord>>(CURATOR_STATE_FILE)
        return map?.[CURATOR_STATE_KEY] ?? null
      })
    },

    async saveCuratorState(record) {
      await mutate(async () => {
        await jsonTransact<Record<string, CuratorStateRecord>>(
          ctx, io, root, CURATOR_STATE_FILE,
          current => ({ ...(current ?? {}), [CURATOR_STATE_KEY]: record }),
        )
      })
    },

    async transactCuratorState(task) {
      await mutate(async () => {
        await jsonTransact<Record<string, CuratorStateRecord>>(ctx, io, root, CURATOR_STATE_FILE, (current) => {
          // 0.3.22 (F-202): null = keep the current record unchanged (the
          // domain update primitive cannot delete; json aligns). The record
          // is ADD-only via the seam — a truly deletable empty is expressed
          // by `current` being null, which jsonTransact turns into "no file".
          const next = task(current?.[CURATOR_STATE_KEY] ?? null)
          if (next === null) return current
          return { ...(current ?? {}), [CURATOR_STATE_KEY]: next }
        })
      })
    },

    async listPending(status: PendingStatus = 'pending') {
      return await mutate(async () => {
        const map = await loadPendingMap()
        return Object.values(map).filter(record => record.status === status)
      })
    },

    async savePending(record) {
      await mutate(async () => {
        await jsonTransact<Record<string, PendingRecord>>(ctx, io, root, PENDING_STATE_FILE, async (current) => {
          const legacy = legacyMigrated ? null : await readJson<Record<string, PendingRecord>>(PENDING_LEGACY_FILE)
          // V6-01 (0.3.34): same exclusion as the retirement read path.
          const map = { ...(await mergedWithFilteredLegacy(legacy, current ?? {})), [record.id]: record }
          return map
        })
      })
    },

    async claimPending(id, claimId) {
      return await mutate(async () => {
        const slot = { claimed: null as PendingRecord | null }
        await jsonTransact<Record<string, PendingRecord>>(ctx, io, root, PENDING_STATE_FILE, async (current) => {
          const legacy = legacyMigrated ? null : await readJson<Record<string, PendingRecord>>(PENDING_LEGACY_FILE)
          // V6-01 (0.3.34): same exclusion as the retirement read path.
          const map = { ...(await mergedWithFilteredLegacy(legacy, current ?? {})) }
          const record = map[id] ?? null
          if (record === null || !canClaimPending(record.status)) return map
          const now = Date.now()
          // 0.3.17 (S3.3, E-24): claiming moves the record to 'executing'
          // atomically — a crash after the runner executed but before the
          // resolve can no longer be re-claimed into a SECOND execution (the
          // resolve only accepts pending/executing, and a fresh claim requires
          // 'pending').
          slot.claimed = { ...record, status: 'executing', claimedBy: claimId, claimedAt: new Date(now).toISOString() }
          map[id] = slot.claimed
          return map
        })
        return slot.claimed ? { ...slot.claimed } : null
      })
    },

    async releasePendingClaim(id, claimId) {
      await mutate(async () => {
        await jsonTransact<Record<string, PendingRecord>>(ctx, io, root, PENDING_STATE_FILE, async (current) => {
          const legacy = legacyMigrated ? null : await readJson<Record<string, PendingRecord>>(PENDING_LEGACY_FILE)
          // V6-01 (0.3.34): same exclusion as the retirement read path.
          const map = { ...(await mergedWithFilteredLegacy(legacy, current ?? {})) }
          const record = map[id]
          // 0.3.17 (S3.3): releasing a CLAIMED-EXECUTING record rolls it back to
          // pending (a runner FAILURE is retryable); a crash leaves it
          // executing + claimed for only the operator to resolve (reject or
          // release + re-stage) — it is never automatically re-claimed.
          // V8-15 (0.3.46): the domain provider guards the status the same way
          // — a RESOLVED record (approved/rejected) is never touched by a
          // release (its audit attribution must not be stripped after the fact).
          if (!record || record.claimedBy !== claimId) return map
          if (record.status !== 'pending' && record.status !== 'executing') return map
          record.status = releasedStatus(record.status)
          delete record.claimedBy
          delete record.claimedAt
          return map
        })
      })
    },

    async tryResolvePending(id, status): Promise<PendingResolution> {
      return await mutate(async () => {
        let result: PendingResolution = { record: null, applied: false }
        let evicted: PendingRecord[] = []
        await jsonTransact<Record<string, PendingRecord>>(ctx, io, root, PENDING_STATE_FILE, async (current) => {
          const legacy = legacyMigrated ? null : await readJson<Record<string, PendingRecord>>(PENDING_LEGACY_FILE)
          // V6-01 (0.3.34): same exclusion as the retirement read path.
          const map = { ...(await mergedWithFilteredLegacy(legacy, current ?? {})) }
          const record = map[id] ?? null
          // 0.3.17 (S3.3): 'executing' (claimed but not yet resolved) is a
          // legal resolve source — a crash mid-approve leaves it there for the
          // operator; a DUPLICATE execution is what this blocks.
          if (record === null || !canResolvePending(record.status)) {
            result = { record, applied: false }
            return map
          }
          const resolved = { ...record, status, resolvedAt: new Date().toISOString() }
          map[id] = resolved
          result = { record: resolved, applied: true }
          // 0.3.22 (F-336): after the write-back, keep the LIVE map bounded by
          // archiving the oldest resolved records above the cap.
          const pruned = enforceResolvedCap(map)
          evicted = pruned.evicted
          return pruned.map
        })
        if (evicted.length > 0) await appendArchive(evicted)
        return result
      })
    },
  }

  ctx.effect(() => ctx.evolutionStateStorage.registerProvider(provider), 'evolution-state-json.provider')
}
