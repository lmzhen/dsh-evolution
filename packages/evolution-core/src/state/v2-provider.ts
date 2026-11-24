/**
 * MVCC-backed StateStore provider.
 *
 * One StateDocument lives in the `state` domain of the home MVCC store. Reads
 * resolve a single commit and never take a writer lock; writes use the one
 * HomeFence and publish a new commit. The document rules are shared with the
 * v1 file provider via `state/document.ts`.
 *
 * @module @deepseek-ai/dsh-evolution-core/state/v2-provider
 */

import { join } from 'node:path'
import type { EvolutionIoLike } from '../io.ts'
import { StoreKernel } from '../store/store-kernel.ts'
import type { StoreWriterFence } from '../store/types.ts'
import type {
  EvolutionStateStorage,
  PendingResolution,
  PendingStatus,
} from '../contract.ts'
import {
  PROVIDER_STORE_V2,
} from './constants.ts'
import {
  assertCuratorRecord,
  assertPendingRecord,
  assertReviewRecord,
  claimPendingInDocument,
  emptyStateDocument,
  listPendingInDocument,
  parseStateDocument,
  releasePendingClaimInDocument,
  resolvePendingInDocument,
  saveCuratorInDocument,
  savePendingInDocument,
  saveReviewInDocument,
  serializeStateDocument,
  snapshotStateDocument,
  transactCuratorInDocument,
  type StateDocument,
} from './document.ts'

/** Registered provider name for the MVCC-backed state is single-sourced in constants.ts. */

export interface StateV2ProviderOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly fence: StoreWriterFence
  readonly storeDir?: string | undefined
  readonly now?: (() => number) | undefined
}

/** Raised when the v2 provider is selected without an initialized head. */
export class StateV2NotInitializedError extends Error {
  readonly code = 'state-v2-not-initialized'

  constructor(home: string) {
    super('evolution-state-v2: no MVCC head at ' + home + '; run the explicit v2 migration first')
    this.name = 'StateV2NotInitializedError'
  }
}

/** Build the MVCC-backed state provider. */
export function createStateV2Provider(options: StateV2ProviderOptions): EvolutionStateStorage {
  const kernel = new StoreKernel({
    io: options.io,
    home: options.home,
    fence: options.fence,
    ...(options.storeDir === undefined ? {} : { storeDir: options.storeDir }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  const readDocument = async (): Promise<StateDocument> => {
    let value: unknown
    try {
      value = (await kernel.query(['state'])).domains.state
    } catch (error) {
      if (error instanceof Error && /not initialized/.test(error.message)) {
        throw new StateV2NotInitializedError(options.home)
      }
      throw error
    }
    if (value === undefined) throw new Error('evolution-state-v2: the state domain is missing from the current commit')
    return parseStateDocument(serializeStateDocument(value as StateDocument))
  }

  const mutateDocument = async <T>(task: (document: StateDocument) => T | Promise<T>): Promise<T> => {
    let result: T
    let ran = false
    await kernel.mutate({
      domains: ['state'],
      source: 'command',
      change: async (current) => {
        if (current.domains.state === undefined) throw new Error('evolution-state-v2: the state domain is missing from the current commit')
        const document = parseStateDocument(serializeStateDocument(current.domains.state as StateDocument))
        result = await task(document)
        ran = true
        return { state: document }
      },
    })
    if (!ran) throw new Error('evolution-state-v2: mutation did not run')
    return result!
  }

  return {
    name: PROVIDER_STORE_V2,
    locking: 'internal',

    async listReviewStates() {
      const document = await readDocument()
      return Object.entries(document.review).map(([sessionId, record]) => {
        const { updatedAt, ...consumer } = record
        return { sessionId, record: structuredClone(consumer), ...(updatedAt === undefined ? {} : { updatedAt }) }
      })
    },

    async loadReviewState(sessionId) {
      const stored = (await readDocument()).review[sessionId]
      if (stored === undefined) return null
      const { updatedAt: _updatedAt, ...consumer } = stored
      return structuredClone(consumer)
    },

    async saveReviewState(sessionId, record) {
      await mutateDocument(document => { saveReviewInDocument(document, sessionId, record, options.now?.() ?? Date.now()) })
    },

    async loadCuratorState() {
      const curator = (await readDocument()).curator
      return curator === null ? null : structuredClone(curator)
    },

    async saveCuratorState(record) {
      await mutateDocument(document => { saveCuratorInDocument(document, record) })
    },

    async transactCuratorState(task) {
      await mutateDocument(document => { transactCuratorInDocument(document, task) })
    },

    async listPending(status: PendingStatus = 'pending') {
      return listPendingInDocument(await readDocument(), status)
    },

    async savePending(record) {
      await mutateDocument(document => { savePendingInDocument(document, record) })
    },

    async claimPending(id, claimId) {
      return await mutateDocument(document => claimPendingInDocument(document, id, claimId))
    },

    async releasePendingClaim(id, claimId) {
      await mutateDocument(document => { releasePendingClaimInDocument(document, id, claimId) })
    },

    async tryResolvePending(id, status, expectedClaimId): Promise<PendingResolution> {
      return await mutateDocument(document => resolvePendingInDocument(document, id, status, expectedClaimId))
    },
  }
}

/** Re-export the document helpers R2 migration/tests need without importing the medium. */
export {
  assertCuratorRecord,
  assertPendingRecord,
  assertReviewRecord,
  emptyStateDocument,
  snapshotStateDocument,
  type StateDocument,
}

/** Path helper shared by migration and diagnostics; the kernel owns the actual file writes. */
export function stateV2StoreDir(home: string): string {
  return join(home, 'store-v2')
}
