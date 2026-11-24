/**
 * File-backed StateStore provider.
 *
 * The provider owns ONE JSON document and every transition is a
 * read-modify-write inside the IO seam's transaction. The document rules live
 * in `state/document.ts`, shared with the v2 MVCC provider, so a claim/resolve
 * or overflow change cannot drift between media.
 *
 * @module @deepseek-ai/dsh-evolution-core/state/store
 */

import { join } from 'node:path'
import { evolutionHome } from '../state-store.ts'
import { transactIo, type EvolutionIoLike } from '../io.ts'
import {
  emptyStateDocument,
  parseStateDocument,
  readStateDocument,
  serializeStateDocument,
  snapshotStateDocument,
  type StateDocument,
  type StateDocumentSnapshot,
} from './document.ts'
import {
  claimPendingInDocument,
  listPendingInDocument,
  releasePendingClaimInDocument,
  resolvePendingInDocument,
  saveCuratorInDocument,
  savePendingInDocument,
  saveReviewInDocument,
  transactCuratorInDocument,
} from './document.ts'
import {
  PROVIDER_STORE,
} from './constants.ts'
import type {
  CuratorStateRecord,
  EvolutionStateStorage,
  PendingRecord,
  PendingResolution,
  PendingStatus,
  ReviewStateRecord,
} from '../contract.ts'

export type { StoredReviewState } from './document.ts'

export interface StateStoreOptions {
  readonly io: EvolutionIoLike
  /** Evolution home (the parent of `state/`); defaults to `evolutionHome()`. */
  readonly home?: string
  /** Override the store file path; used by migration/fixture tests. */
  readonly path?: string
}

/** A complete store image, built by migration or by the provider itself. */
export type StateStoreSnapshot = StateDocumentSnapshot

/** Validate and publish a complete store image. The write is create-if-absent:
 * an existing store is never overwritten by a migration. */
export async function writeStateStoreSnapshot(io: EvolutionIoLike, path: string, snapshot: StateStoreSnapshot): Promise<void> {
  const document: StateDocument = { ...emptyStateDocument(), ...snapshot }
  const text = serializeStateDocument(document)
  // Parsing our own image catches a migration source that produced a bad record
  // before the first byte reaches the medium.
  parseStateDocument(text)
  if (io.exists !== undefined && await io.exists(path)) throw new Error('evolution-state-store: refusing to overwrite an existing store: ' + path)
  if (io.createTextIfAbsent !== undefined) {
    await io.createTextIfAbsent(path, text)
    return
  }
  if (io.exists !== undefined && await io.exists(path)) throw new Error('evolution-state-store: refusing to overwrite an existing store: ' + path)
  await io.writeText(path, text)
}

/** Parse a whole store image synchronously; a corrupt store fails loud. */
export function parseStateStoreImage(text: string): StateStoreSnapshot {
  return snapshotStateDocument(parseStateDocument(text))
}

/** Read a validated store image; a corrupt store fails loud. */
export async function readStateStoreSnapshot(io: EvolutionIoLike, path: string): Promise<StateStoreSnapshot> {
  return snapshotStateDocument(await readStateDocument(io, path))
}

/**
 * Build the file-backed provider. All mutating methods are a single
 * `transactIo` RMW over the shared document; readers parse the current file,
 * never a cached copy.
 */
export function createStateStoreProvider(options: StateStoreOptions): EvolutionStateStorage {
  const file = options.path ?? join(options.home ?? evolutionHome(), 'state', 'store.json')
  const io = options.io

  const read = async (): Promise<StateDocument> => await readStateDocument(io, file)

  const mutate = async <T>(task: (document: StateDocument) => T | Promise<T>): Promise<T> => {
    let result: T
    let ran = false
    await transactIo(io, file, (current) => {
      const document = parseStateDocument(current)
      const outcome = task(document)
      if (outcome instanceof Promise) {
        return outcome.then((value) => {
          result = value
          ran = true
          const next = serializeStateDocument(document)
          return next === current ? current : next
        })
      }
      result = outcome
      ran = true
      const next = serializeStateDocument(document)
      return next === current ? current : next
    })
    if (!ran) throw new Error('evolution-state-store: transaction did not run the task')
    return result!
  }

  return {
    name: PROVIDER_STORE,

    async listReviewStates() {
      return Object.entries((await read()).review).map(([sessionId, record]) => {
        const { updatedAt, ...consumer } = record
        return { sessionId, record: structuredClone(consumer), ...(updatedAt === undefined ? {} : { updatedAt }) }
      })
    },

    async loadReviewState(sessionId) {
      const stored = (await read()).review[sessionId]
      if (stored === undefined) return null
      const { updatedAt: _updatedAt, ...consumer } = stored
      return structuredClone(consumer)
    },

    async saveReviewState(sessionId, record) {
      await mutate(document => { saveReviewInDocument(document, sessionId, record) })
    },

    async loadCuratorState() {
      const curator = (await read()).curator
      return curator === null ? null : structuredClone(curator)
    },

    async saveCuratorState(record) {
      await mutate(document => { saveCuratorInDocument(document, record) })
    },

    async transactCuratorState(task) {
      await mutate(document => { transactCuratorInDocument(document, task) })
    },

    async listPending(status: PendingStatus = 'pending') {
      return listPendingInDocument(await read(), status)
    },

    async savePending(record) {
      await mutate(document => { savePendingInDocument(document, record) })
    },

    async claimPending(id, claimId) {
      return await mutate(document => claimPendingInDocument(document, id, claimId))
    },

    async releasePendingClaim(id, claimId) {
      await mutate(document => { releasePendingClaimInDocument(document, id, claimId) })
    },

    async tryResolvePending(id, status, expectedClaimId): Promise<PendingResolution> {
      return await mutate(document => resolvePendingInDocument(document, id, status, expectedClaimId))
    },
  }
}

export type { CuratorStateRecord, PendingRecord, ReviewStateRecord }
