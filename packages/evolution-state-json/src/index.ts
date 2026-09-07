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
import { canClaimPending, canResolvePending, releasedStatus, type CuratorStateRecord, type EvolutionStateStorage, type PendingRecord, type PendingResolution, type PendingStatus, type ReviewStateRecord } from '@deepseek-ai/dsh-evolution-state-storage'
import { join } from 'node:path'

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

const RECORD_MAP_FILES = new Set(['review-state.json', 'curator-state.json', 'pending-state.json', 'pending.json'])

/** 0.3.17 (E-9): a malformed state file used to parse to `null` and was then
 * OVERWRITTEN by the next save — every other session's review state / the
 * whole pending table vanished silently. Fail loud instead: preserve the
 * original bytes beside it and throw, so the operator can rescue and the
 * corruption is never accepted as "empty". */
async function quarantine(io: () => EvolutionIoLike, root: string, file: string, raw: string, reason: string): Promise<never> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = `${join(root, file)}.corrupt-${stamp}-${Math.random().toString(36).slice(2, 6)}`
  await io().writeText(dest, raw).catch(() => {})
  throw new Error(`evolution state file "${file}" is not valid JSON (${reason}); original preserved at ${dest} — inspect and fix it, then retry.`)
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
 */
export async function jsonTransact<T>(
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
      if (RECORD_MAP_FILES.has(file) && isPlainRecord(parsed)) {
        for (const [recordId, record] of Object.entries(parsed as Record<string, unknown>)) {
          if (!isPlainRecord(record)) {
            return await quarantine(io, root, file, current, `expected a plain object for record "${recordId}", got ${record === null ? 'null' : Array.isArray(record) ? 'an array' : typeof record}`)
          }
        }
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
  const io = () => ctx.evolutionIo.provider()
  const pathOf = (file: string) => join(root, file)

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
    if (RECORD_MAP_FILES.has(file) && isPlainRecord(parsed)) {
      for (const [recordId, record] of Object.entries(parsed as Record<string, unknown>)) {
        if (!isPlainRecord(record)) {
          return await quarantine(io, root, file, raw, `expected a plain object for record "${recordId}", got ${record === null ? 'null' : Array.isArray(record) ? 'an array' : typeof record}`)
        }
      }
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
  let archivedIdsCache: Set<string> | null = null
  async function readArchivedIds(): Promise<Set<string>> {
    if (archivedIdsCache !== null) return archivedIdsCache
    const ids = new Set<string>()
    try {
      const rawArchive = await readJson<Array<{ id?: string } | null>>('pending-state-archive.json')
      if (Array.isArray(rawArchive)) {
        for (const entry of rawArchive) if (entry && typeof entry.id === 'string') ids.add(entry.id)
      }
      // V6-31 (0.3.37): after a rotation the older archive entries live in the
      // .bak — read it too, so an archived id evicted to the bak keeps
      // excluding its legacy twin (the retirement filter never loses its
      // evidence). Best-effort: an unreadable bak only weakens the filter.
      try {
        const rawBak = await readJson<Array<{ id?: string } | null>>('pending-state-archive.json.bak')
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
    archivedIdsCache = ids
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
      await jsonTransact(io, root, 'pending-state.json', fresh => ({ ...retired, ...(fresh ?? {}) }))
      await io().rename(pathOf('pending.json'), pathOf('pending.json.migrated'))
      legacyMigrated = true
      return retired
    } catch {
      // Best-effort retirement — the file simply stays until a later safe
      // point; the read keeps the legacy view (previous behavior).
      return legacy
    }
  }
  async function loadPendingMap(): Promise<Record<string, PendingRecord>> {
    const [current, legacy] = await Promise.all([
      readJson<Record<string, PendingRecord>>('pending-state.json'),
      readJson<Record<string, PendingRecord>>('pending.json'),
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
      await transactIo(io(), pathOf('pending-state-archive.json'), async (current) => {
        let archive: PendingRecord[] = []
        if (current !== null) {
          try {
            const parsed = JSON.parse(current) as unknown
            if (Array.isArray(parsed)) archive = parsed as PendingRecord[]
          } catch {
            // unrecoverable archive — best-effort: start fresh
          }
        }
        // V5-07 (0.3.33): archives written before the dedupe key existed may
        // carry duplicate entries (same id+status+resolvedAt) that counted
        // toward the cap forever — collapse them on load (first occurrence
        // wins, best-effort; the .bak may still hold them, audit is allowed
        // to fall behind).
        const archiveKeys = new Set<string>()
        const collapsed = archive.filter((entry) => {
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
        const seen = new Set(archive.map(pendingArchiveKey))
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
            await io().writeText(pathOf('pending-state-archive.json.bak'), JSON.stringify(archive, null, 2)).catch(() => {})
          }
          // V7-08 (0.3.44): the rotation just moved ids into/out of the active
          // archive — the once-per-instance archivedIdsCache would keep
          // excluding with a stale view (a ghost pending twin could slip in
          // through a mutation that runs before any list). Invalidate so the
          // next read rebuilds from both sidecars.
          archivedIdsCache = null
          return JSON.stringify((fresh.length > 0 ? fresh : next).slice(-ARCHIVE_RESOLVED_CAP), null, 2)
        }
        // V7-08 (0.3.44): ANY archive append below the rotation cap still adds
        // new ids the once-read cache never saw — invalidate on the plain
        // write too (a stale cache would let a ghost twin in through a later
        // mutation before any list).
        archivedIdsCache = null
        return JSON.stringify(next, null, 2)
      })
    } catch {
      // Audit aid only: never let an archive write failure surface as a resolve failure.
    }
  }

  const provider: EvolutionStateStorage = {
    name: 'json',

    async loadReviewState(sessionId) {
      return await mutate(async () => {
        const map = await readJson<Record<string, ReviewStateRecord>>('review-state.json')
        return map?.[sessionId] ?? null
      })
    },

    async saveReviewState(sessionId, record) {
      await mutate(async () => {
        await jsonTransact<Record<string, ReviewStateRecord>>(io, root, 'review-state.json', current => ({ ...(current ?? {}), [sessionId]: record }))
      })
    },

    async loadCuratorState() {
      return await mutate(async () => {
        const map = await readJson<Record<string, CuratorStateRecord>>('curator-state.json')
        return map?.primary ?? null
      })
    },

    async saveCuratorState(record) {
      await mutate(async () => {
        await jsonTransact<Record<string, CuratorStateRecord>>(io, root, 'curator-state.json', current => ({ ...(current ?? {}), primary: record }))
      })
    },

    async transactCuratorState(task) {
      await mutate(async () => {
        await jsonTransact<Record<string, CuratorStateRecord>>(io, root, 'curator-state.json', (current) => {
          // 0.3.22 (F-202): null = keep the current record unchanged (the
          // domain update primitive cannot delete; json aligns). The record
          // is ADD-only via the seam — a truly deletable empty is expressed
          // by `current` being null, which jsonTransact turns into "no file".
          const next = task(current?.primary ?? null)
          if (next === null) return current
          return { ...(current ?? {}), primary: next }
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
        await jsonTransact<Record<string, PendingRecord>>(io, root, 'pending-state.json', async (current) => {
          const legacy = legacyMigrated ? null : await readJson<Record<string, PendingRecord>>('pending.json')
          // V6-01 (0.3.34): same exclusion as the retirement read path.
          const map = { ...(await mergedWithFilteredLegacy(legacy, current ?? {})), [record.id]: record }
          return map
        })
      })
    },

    async claimPending(id, claimId) {
      return await mutate(async () => {
        const slot = { claimed: null as PendingRecord | null }
        await jsonTransact<Record<string, PendingRecord>>(io, root, 'pending-state.json', async (current) => {
          const legacy = legacyMigrated ? null : await readJson<Record<string, PendingRecord>>('pending.json')
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
        await jsonTransact<Record<string, PendingRecord>>(io, root, 'pending-state.json', async (current) => {
          const legacy = legacyMigrated ? null : await readJson<Record<string, PendingRecord>>('pending.json')
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
        await jsonTransact<Record<string, PendingRecord>>(io, root, 'pending-state.json', async (current) => {
          const legacy = legacyMigrated ? null : await readJson<Record<string, PendingRecord>>('pending.json')
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
