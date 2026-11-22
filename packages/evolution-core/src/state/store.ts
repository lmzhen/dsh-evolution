/**
 * File-backed StateStore provider.
 *
 * This is the first D1 step: the provider owns ONE JSON file and every
 * transition is a read-modify-write inside the IO seam's transaction. There is
 * no process-local authoritative copy; `reload()` is therefore unnecessary and
 * reads always observe the medium.
 *
 * It is intentionally not mounted by the bundle yet: the domain provider is
 * still the shipped one until the migration/rollback path is implemented.
 * @module @deepseek-ai/dsh-evolution-core/state/store
 */

import { join } from 'node:path'
import { evolutionHome } from '../state-store.ts'
import { transactIo, type EvolutionIoLike } from '../io.ts'
import {
  assertCloneable,
  canClaimPending,
  canResolvePending,
  cloneRecord,
  recordIssue,
  releasedStatus,
  CURATOR_STATE_TABLE,
  PENDING_RESOLVED_CAP,
  PENDING_TABLE,
  PROVIDER_STORE,
  REVIEW_STATE_SESSION_CAP,
  REVIEW_STATE_TABLE,
  selectPendingOverflow,
  selectSessionOverflow,
  type CuratorStateRecord,
  type EvolutionStateStorage,
  type PendingRecord,
  type PendingResolution,
  type PendingStatus,
  type ReviewStateRecord,
} from './index.ts'

const STORE_VERSION = 1

type StoredReviewState = ReviewStateRecord & { updatedAt?: number }

interface StoreFile {
  version: typeof STORE_VERSION
  review: Record<string, StoredReviewState>
  curator: CuratorStateRecord | null
  pending: Record<string, PendingRecord>
}

export interface StateStoreOptions {
  readonly io: EvolutionIoLike
  /** Evolution home (the parent of `state/`); defaults to `evolutionHome()`. */
  readonly home?: string
  /** Override the store file path; used by migration/fixture tests. */
  readonly path?: string
}

const emptyStore = (): StoreFile => ({ version: STORE_VERSION, review: {}, curator: null, pending: {} })

function invalid(message: string): never {
  throw new Error('evolution-state-store: ' + message)
}

/** Parse and validate one whole store image. A corrupt store fails loud: silently
 * treating it as empty would overwrite the only copy. */
function parseStore(text: string | null): StoreFile {
  if (text === null || text.trim() === '') return emptyStore()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    invalid('store is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) invalid('store must be an object')
  const candidate = raw as Record<string, unknown>
  if (candidate.version !== STORE_VERSION) invalid('unsupported store version: ' + String(candidate.version))
  const review = candidate.review
  const pending = candidate.pending
  if (typeof review !== 'object' || review === null || Array.isArray(review)) invalid('review must be an object')
  if (typeof pending !== 'object' || pending === null || Array.isArray(pending)) invalid('pending must be an object')
  const store = emptyStore()
  for (const [sessionId, record] of Object.entries(review as Record<string, unknown>)) {
    const issue = recordIssue(REVIEW_STATE_TABLE, record)
    if (issue !== null) invalid(`review[${sessionId}]: ${issue}`)
    store.review[sessionId] = cloneRecord(record as StoredReviewState)
  }
  for (const [key, record] of Object.entries(pending as Record<string, unknown>)) {
    const issue = recordIssue(PENDING_TABLE, record)
    if (issue !== null) invalid(`pending[${key}]: ${issue}`)
    const pendingRecord = cloneRecord(record as PendingRecord)
    // A hand-written/legacy slot whose key drifted from record.id is reachable
    // by claim/resolve only after re-keying; the canonical id wins.
    if (pendingRecord.id !== key) {
      if (store.pending[pendingRecord.id] === undefined) store.pending[pendingRecord.id] = pendingRecord
      continue
    }
    store.pending[pendingRecord.id] = pendingRecord
  }
  const curator = candidate.curator
  if (curator !== undefined && curator !== null) {
    const issue = recordIssue(CURATOR_STATE_TABLE, curator)
    if (issue !== null) invalid('curator: ' + issue)
    store.curator = cloneRecord(curator as CuratorStateRecord)
  }
  return store
}

const serialize = (store: StoreFile): string => JSON.stringify(store, null, 2) + '\n'

/**
 * Build the file-backed provider. All mutating methods are a single
 * `transactIo` RMW; readers parse the current file, never a cached copy.
 */
export function createStateStoreProvider(options: StateStoreOptions): EvolutionStateStorage {
  const file = options.path ?? join(options.home ?? evolutionHome(), 'state', 'store.json')
  const io = options.io

  const read = async (): Promise<StoreFile> => parseStore(await io.readText(file))

  const mutate = async <T>(task: (store: StoreFile) => T | Promise<T>): Promise<T> => {
    let result: T
    let ran = false
    await transactIo(io, file, (current) => {
      const store = parseStore(current)
      // The task assigns the result; it cannot throw with a half-written file
      // because the transaction only writes after this callback resolves.
      const outcome = task(store)
      if (outcome instanceof Promise) {
        return outcome.then((value) => {
          result = value
          ran = true
          const next = serialize(store)
          return next === current ? current : next
        })
      }
      result = outcome
      ran = true
      const next = serialize(store)
      return next === current ? current : next
    })
    if (!ran) throw new Error('evolution-state-store: transaction did not run the task')
    return result!
  }

  const savePendingValidated = (record: PendingRecord): PendingRecord => {
    const issue = recordIssue(PENDING_TABLE, record) ?? assertCloneable(record)
    if (issue !== null) throw new Error('evolution-state-store: refusing to persist an invalid pending record: ' + issue)
    return cloneRecord(record)
  }

  return {
    name: PROVIDER_STORE,

    async loadReviewState(sessionId) {
      const stored = (await read()).review[sessionId]
      if (stored === undefined) return null
      const { updatedAt: _updatedAt, ...consumer } = stored
      return structuredClone(consumer)
    },

    async saveReviewState(sessionId, record) {
      const issue = recordIssue(REVIEW_STATE_TABLE, record) ?? assertCloneable(record)
      if (issue !== null) throw new Error('evolution-state-store: refusing to persist an invalid review-state record: ' + issue)
      await mutate((store) => {
        store.review[sessionId] = { ...cloneRecord(record), updatedAt: Date.now() }
        const entries = Object.entries(store.review)
          .filter(([key]) => key !== sessionId)
          .map(([key, row]) => ({ key, updatedAt: row.updatedAt ?? 0 }))
        for (const victim of selectSessionOverflow(entries, {
          keyOf: entry => entry.key,
          stampOf: entry => entry.updatedAt,
        }, REVIEW_STATE_SESSION_CAP)) {
          // Re-read the stamp immediately before deleting; the transaction
          // already serializes writers, so this is only for a value the task
          // itself changed earlier in this same callback.
          const current = store.review[victim]
          if (current === undefined) continue
          if ((current.updatedAt ?? 0) !== entries.find(entry => entry.key === victim)?.updatedAt) continue
          delete store.review[victim]
        }
      })
    },

    async loadCuratorState() {
      const curator = (await read()).curator
      return curator === null ? null : structuredClone(curator)
    },

    async saveCuratorState(record) {
      const issue = recordIssue(CURATOR_STATE_TABLE, record) ?? assertCloneable(record)
      if (issue !== null) throw new Error('evolution-state-store: refusing to persist an invalid curator-state record: ' + issue)
      await mutate((store) => { store.curator = cloneRecord(record) })
    },

    async transactCuratorState(task) {
      await mutate((store) => {
        const current = store.curator === null ? null : cloneRecord(store.curator)
        const next = task(current)
        // The seam contract: null means "keep the current record", not delete.
        if (next === null) return
        const issue = recordIssue(CURATOR_STATE_TABLE, next) ?? assertCloneable(next)
        if (issue !== null) throw new Error('evolution-state-store: refusing to persist an invalid curator-state record: ' + issue)
        store.curator = cloneRecord(next)
      })
    },

    async listPending(status: PendingStatus = 'pending') {
      const store = await read()
      const seen = new Set<string>()
      const out: PendingRecord[] = []
      for (const record of Object.values(store.pending)) {
        if (record.status !== status) continue
        if (seen.has(record.id)) continue
        seen.add(record.id)
        out.push(structuredClone(record))
      }
      return out
    },

    async savePending(record) {
      const valid = savePendingValidated(record)
      await mutate((store) => { store.pending[valid.id] = valid })
    },

    async claimPending(id, claimId) {
      let claimed: PendingRecord | null = null
      await mutate((store) => {
        const current = store.pending[id]
        if (current === undefined || !canClaimPending(current.status)) return
        const next: PendingRecord = {
          ...current,
          status: 'executing',
          claimedBy: claimId,
          claimedAt: new Date().toISOString(),
        }
        store.pending[id] = next
        claimed = structuredClone(next)
      })
      return claimed
    },

    async releasePendingClaim(id, claimId) {
      await mutate((store) => {
        const current = store.pending[id]
        if (current === undefined || current.claimedBy !== claimId) return
        if (current.status !== 'pending' && current.status !== 'executing') return
        const next: PendingRecord = { ...current, status: releasedStatus(current.status) }
        delete next.claimedBy
        delete next.claimedAt
        store.pending[id] = next
      })
    },

    async tryResolvePending(id, status, expectedClaimId): Promise<PendingResolution> {
      let outcome: PendingResolution = { record: null, applied: false }
      await mutate((store) => {
        const current = store.pending[id]
        if (current === undefined) return
        if (!canResolvePending(current.status)) {
          outcome = { record: structuredClone(current), applied: false }
          return
        }
        if (expectedClaimId !== undefined && current.claimedBy !== expectedClaimId) {
          outcome = { record: structuredClone(current), applied: false }
          return
        }
        const resolved: PendingRecord = { ...current, status, resolvedAt: new Date().toISOString() }
        store.pending[id] = resolved
        outcome = { record: structuredClone(resolved), applied: true }
        for (const victim of selectPendingOverflow(Object.values(store.pending), PENDING_RESOLVED_CAP)) {
          if (store.pending[victim.id]?.resolvedAt === victim.resolvedAt) delete store.pending[victim.id]
        }
      })
      return outcome
    },
  }
}
