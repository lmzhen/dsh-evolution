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
import { evolutionHome, makeSerialQueue, transactIo } from '@deepseek-ai/dsh-evolution-core'
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

export function apply(ctx: Context, rawConfig: Config): void {
  const root = (rawConfig.root ?? '').trim() || evolutionHome()
  const io = () => ctx.evolutionIo.provider()
  const pathOf = (file: string) => join(root, file)

  /** 0.3.17 (E-9): a malformed state file used to parse to `null` and was then
   * OVERWRITTEN by the next save — every other session's review state / the
   * whole pending table vanished silently. Fail loud instead: preserve the
   * original bytes beside it and throw, so the operator can rescue and the
   * corruption is never accepted as "empty". */
  async function quarantine(file: string, raw: string, reason: string): Promise<never> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = `${pathOf(file)}.corrupt-${stamp}-${Math.random().toString(36).slice(2, 6)}`
    await io().writeText(dest, raw).catch(() => {})
    throw new Error(`evolution state file "${file}" is not valid JSON (${reason}); original preserved at ${dest} — inspect and fix it, then retry.`)
  }

  async function readJson<T>(file: string): Promise<T | null> {
    const raw = await io().readText(pathOf(file))
    if (raw === null) return null
    let parsed: T
    try {
      parsed = JSON.parse(raw) as T
    } catch (error) {
      return await quarantine(file, raw, error instanceof Error ? error.message : String(error))
    }
    // 0.3.22 (F-215): a valid JSON that is the wrong top-level shape is a
    // corrupt record map, not "empty" — fail loud so the operator notices
    // instead of the next save silently wiping every other record.
    // 0.3.27 (V4-06): this check lives OUTSIDE the parse try, so a wrong-shape
    // quarantine (which throws) does not fall into the catch above and
    // quarantine the file a SECOND time (two `.corrupt-*` copies per read).
    if (RECORD_MAP_FILES.has(file) && !isPlainRecord(parsed)) {
      const kind = Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed
      return await quarantine(file, raw, `expected a plain JSON object (map of records), got ${kind}`)
    }
    return parsed
  }

  /**
   * Cross-process JSON-file RMW (v3-audit M-8): every read-modify-write state
   * mutation runs inside the IO backend's transact lock (via transactIo) so a
   * second process sharing DSH_HOME cannot interleave its claim/resolve.
   * `task` returns the next value (null = delete); the legacy `pending.json`
   * merge stays inside the task via `readJson` where relevant.
   */
  async function jsonTransact<T>(file: string, task: (current: T | null) => T | null | Promise<T | null>): Promise<void> {
    await transactIo(ctx.evolutionIo.provider(), pathOf(file), async (current) => {
      let parsed: T | null = null
      if (current !== null) {
        try {
          parsed = JSON.parse(current) as T
        } catch (error) {
          return await quarantine(file, current, error instanceof Error ? error.message : String(error))
        }
        // 0.3.27 (V4-06): outside the parse try — a wrong-shape quarantine must
        // not fall into the catch and quarantine a second time.
        if (RECORD_MAP_FILES.has(file) && !isPlainRecord(parsed)) {
          const kind = Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed
          return await quarantine(file, current, `expected a plain JSON object (map of records), got ${kind}`)
        }
      }
      const next = await task(parsed)
      return next === null ? null : JSON.stringify(next, null, 2)
    })
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
  async function loadPendingMap(): Promise<Record<string, PendingRecord>> {
    const [current, legacy] = await Promise.all([
      readJson<Record<string, PendingRecord>>('pending-state.json'),
      readJson<Record<string, PendingRecord>>('pending.json'),
    ])
    return { ...(legacy ?? {}), ...(current ?? {}) }
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
    const oldest = resolved
      .sort((a, b) => {
        const at = a.resolvedAt ? Date.parse(a.resolvedAt) : Number.MAX_SAFE_INTEGER
        const bt = b.resolvedAt ? Date.parse(b.resolvedAt) : Number.MAX_SAFE_INTEGER
        return at - bt
      })
      .slice(0, overflow)
    const evictIds = new Set(oldest.map(record => record.id))
    const kept: Record<string, PendingRecord> = {}
    for (const [key, value] of Object.entries(map)) {
      if (!evictIds.has(key)) kept[key] = value
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
        const seen = new Set(archive.map(pendingArchiveKey))
        const fresh = records.filter(record => !seen.has(pendingArchiveKey(record)))
        if (fresh.length === 0) return current
        const next = [...archive, ...fresh]
        if (next.length > ARCHIVE_RESOLVED_CAP) {
          // Rotate the full pre-rotation history to a `.bak` sidecar and restart
          // the active sidecar from the batch that overflowed it (log-rotation
          // style), so the file and its rewrite are bounded. Best-effort: a
          // failed rotate only loses the rotated audit copy.
          await io().writeText(pathOf('pending-state-archive.json.bak'), JSON.stringify(archive, null, 2)).catch(() => {})
          return JSON.stringify(fresh, null, 2)
        }
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
        await jsonTransact<Record<string, ReviewStateRecord>>('review-state.json', current => ({ ...(current ?? {}), [sessionId]: record }))
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
        await jsonTransact<Record<string, CuratorStateRecord>>('curator-state.json', current => ({ ...(current ?? {}), primary: record }))
      })
    },

    async transactCuratorState(task) {
      await mutate(async () => {
        await jsonTransact<Record<string, CuratorStateRecord>>('curator-state.json', (current) => {
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
        await jsonTransact<Record<string, PendingRecord>>('pending-state.json', async (current) => {
          const legacy = await readJson<Record<string, PendingRecord>>('pending.json')
          const map = { ...(legacy ?? {}), ...(current ?? {}), [record.id]: record }
          return map
        })
      })
    },

    async claimPending(id, claimId) {
      return await mutate(async () => {
        const slot = { claimed: null as PendingRecord | null }
        await jsonTransact<Record<string, PendingRecord>>('pending-state.json', async (current) => {
          const legacy = await readJson<Record<string, PendingRecord>>('pending.json')
          const map = { ...(legacy ?? {}), ...(current ?? {}) }
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
        await jsonTransact<Record<string, PendingRecord>>('pending-state.json', async (current) => {
          const legacy = await readJson<Record<string, PendingRecord>>('pending.json')
          const map = { ...(legacy ?? {}), ...(current ?? {}) }
          const record = map[id]
          // 0.3.17 (S3.3): releasing a CLAIMED-EXECUTING record rolls it back to
          // pending (a runner FAILURE is retryable); a crash leaves it
          // executing + claimed for only the operator to resolve (reject or
          // release + re-stage) — it is never automatically re-claimed.
          if (!record || record.claimedBy !== claimId) return map
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
        await jsonTransact<Record<string, PendingRecord>>('pending-state.json', async (current) => {
          const legacy = await readJson<Record<string, PendingRecord>>('pending.json')
          const map = { ...(legacy ?? {}), ...(current ?? {}) }
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
