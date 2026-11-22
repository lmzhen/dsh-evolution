/**
 * Explicit one-way migration: old storage-domain tables → file StateStore.
 *
 * This module is intentionally NOT a compatibility reader. It runs once, writes a
 * complete snapshot with create-if-absent, leaves the domain data untouched, and
 * writes a marker. Rolling back is switching the provider back to `domain`.
 * @module @deepseek-ai/dsh-evolution-core/state/migrate
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-evolution-platform/contract'
import { storageDomainPort } from '@deepseek-ai/dsh-evolution-platform/ports'
import { withFileLock } from '@deepseek-ai/dsh-evolution-platform/values'
import { evolutionHome } from '../state-store.ts'
import type { EvolutionIoLike } from '../io.ts'
import { writeStateStoreSnapshot, type StoredReviewState } from './store.ts'
import { EVOLUTION_DOMAIN } from './domain/index.ts'
import {
  CURATOR_STATE_KEY,
  STATE_MIGRATION_MARKER,
  CURATOR_STATE_TABLE,
  PENDING_TABLE,
  REVIEW_STATE_TABLE,
  type CuratorStateRecord,
  PENDING_STATUSES,
  type PendingRecord,
} from './index.ts'

export interface StateMigrationOptions {
  readonly io: EvolutionIoLike
  /** Evolution home; defaults to `evolutionHome()`. */
  readonly home?: string
  /** Count and validate only; write neither store nor marker. */
  readonly dryRun?: boolean
  readonly now?: () => number
}

export interface StateMigrationResult {
  readonly reviewSessions: number
  readonly pending: number
  readonly curator: boolean
  readonly path: string
  readonly dryRun: boolean
}

export { STATE_MIGRATION_MARKER }

/**
 * Migrate the three state tables. The store file is published with
 * create-if-absent, so a stale rerun cannot overwrite a newer store.
 */
async function migrateDomainToStoreUnlocked(ctx: Context, options: StateMigrationOptions): Promise<StateMigrationResult> {
  const home = options.home ?? evolutionHome()
  const storePath = join(home, 'state', 'store.json')
  const markerPath = join(home, 'state', STATE_MIGRATION_MARKER)
  const io = options.io
  if (!options.dryRun && await io.exists(storePath)) {
    throw new Error('evolution-state-migrate: store already exists; refusing to overwrite it: ' + storePath)
  }
  // Prefer the provider that is already mounted: the host normally has the
  // domain row mounted, and opening the same KV domain a second time fails with
  // already-open. The optional listReviewStates() is the migration read; the
  // fallback is for a host that runs the migration before the state row mounts.
  const mounted = (ctx as unknown as { evolutionStateStorage?: { provider(name?: string): { listReviewStates?(): Promise<readonly { sessionId: string; record: StoredReviewState }[]>; listPending(status?: string): Promise<readonly PendingRecord[]>; loadCuratorState(): Promise<CuratorStateRecord | null> } | undefined } }).evolutionStateStorage?.provider?.('domain')
  let review: Record<string, StoredReviewState> = {}
  let pending: Record<string, PendingRecord> = {}
  let curator: CuratorStateRecord | null = null
  if (mounted?.listReviewStates !== undefined) {
    for (const row of await mounted.listReviewStates()) review[row.sessionId] = row.record
    for (const status of PENDING_STATUSES) {
      for (const record of await mounted.listPending(status)) if (pending[record.id] === undefined) pending[record.id] = record
    }
    curator = await mounted.loadCuratorState()
  } else {
    const facility = storageDomainPort(ctx)
    if (!facility) throw new Error('evolution-state-migrate: @deepseek-ai/dsh-storage-domain is not mounted')
    const domain = await facility.open<Domain<typeof EVOLUTION_DOMAIN>>(EVOLUTION_DOMAIN)
    try {
      review = Object.fromEntries(
        [...domain.table(REVIEW_STATE_TABLE).entries()] as Array<[string, StoredReviewState]>,
      )
      pending = {}
      for (const [key, record] of domain.table(PENDING_TABLE).entries() as Iterable<[string, PendingRecord]>) {
        if (pending[record.id] === undefined) pending[record.id] = record
        else if (key === record.id) pending[record.id] = record
      }
      const curated = domain.table(CURATOR_STATE_TABLE).get(CURATOR_STATE_KEY) as CuratorStateRecord | undefined
      curator = curated === undefined ? null : curated
    } finally {
      await domain.close()
    }
  }
  const result: StateMigrationResult = {
    reviewSessions: Object.keys(review).length,
    pending: Object.keys(pending).length,
    curator: curator !== null,
    path: storePath,
    dryRun: options.dryRun === true,
  }
  if (options.dryRun === true) return result
  await writeStateStoreSnapshot(io, storePath, { review, curator, pending })
  await io.writeText(markerPath, JSON.stringify({
    migratedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
    source: 'domain',
    target: 'store',
    reviewSessions: result.reviewSessions,
    pending: result.pending,
    curator: result.curator,
  }, null, 2) + '\n')
  return result
}


/**
 * Public entry: hold the same cross-process state.lock every EvolutionState
 * operation holds, so no state write can interleave between the snapshot read
 * and the marker publish.
 */
export async function migrateDomainToStore(ctx: Context, options: StateMigrationOptions): Promise<StateMigrationResult> {
  const home = options.home ?? evolutionHome()
  await mkdir(home, { recursive: true })
  return withFileLock(join(home, 'state.lock'), () => migrateDomainToStoreUnlocked(ctx, { ...options, home }))
}
