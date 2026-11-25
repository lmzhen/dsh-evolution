/**
 * Explicit one-way migration: old storage-domain tables → file StateStore.
 *
 * This module is intentionally NOT a compatibility reader. It runs once, writes a
 * complete snapshot with create-if-absent, leaves the domain data untouched, and
 * writes a marker. Rolling back is switching the provider back to `domain`.
 * @module @deepseek-ai/dsh-evolution-core/state/migrate
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-evolution-platform/contract'
import { storageDomainPort } from '@deepseek-ai/dsh-evolution-platform/ports'
import { withFileLock } from '@deepseek-ai/dsh-evolution-platform/values/fs'
import { evolutionHome, evolutionRoot } from '../state-store.ts'
import { memoryRoot } from '../memory-store.ts'
import { suppressedFile, usageFile } from '../usage.ts'
import type { EvolutionIoLike } from '../io.ts'
import { readStateStoreSnapshot, writeStateStoreSnapshot, type StateStoreSnapshot, type StoredReviewState } from './store.ts'
import { emptyStateDocument } from './document.ts'
import { StoreKernel } from '../store/store-kernel.ts'
import type { StoreWriterFence } from '../store/types.ts'
import { liveHomeFence } from '../mutation-authority.ts'
import { STATE_V2_MIGRATION_MARKER, STATE_V2_PENDING_MARKER, PROVIDER_STORE_V2 } from './constants.ts'
import { readStoreActivation, storeV2ActivationPath } from './activation.ts'
import { parseRunIndexDocument, type RunIndexDocument } from '../run-registry.ts'
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
  /** Skill tree root; defaults to `<dshHome>/skills` through evolutionRoot(). */
  readonly skillsRoot?: string
  /** Memory root; defaults to `<dshHome>/memories`. */
  readonly memoryRoot?: string
  /** Override the three discovery documents' paths (custom config roots). */
  readonly discoveryPaths?: { readonly domainMap: string; readonly projectionJournal: string; readonly viewSnapshots: string }
  /** Override the feedback rebuild-cache path. */
  readonly feedbackPath?: string
  /** Stage the migration for the next host start instead of activating it now. */
  readonly stage?: boolean
  /** Reuse an already-held fence (activation holds it before state.lock). */
  readonly fence?: StoreWriterFence
  readonly now?: () => number
}

export interface StateMigrationResult {
  readonly reviewSessions: number
  readonly pending: number
  readonly curator: boolean
  readonly path: string
  readonly dryRun: boolean
}

/** Read the mounted/legacy domain and return one validated snapshot. */
async function readDomainSnapshot(ctx: Context): Promise<StateStoreSnapshot> {
  // Prefer the provider that is already mounted: the host normally has the
  // domain row mounted, and opening the same KV domain a second time fails with
  // already-open. The optional listReviewStates() is the migration read; the
  // fallback is for a host that runs the migration before the state row mounts.
  const mounted = (ctx as unknown as { evolutionStateStorage?: { provider(name?: string): { reload?(): Promise<void>; listReviewStates?(): Promise<readonly { sessionId: string; record: StoredReviewState }[]>; listPending(status?: string): Promise<readonly PendingRecord[]>; loadCuratorState(): Promise<CuratorStateRecord | null> } | undefined } }).evolutionStateStorage?.provider?.('domain')
  let review: Record<string, StoredReviewState> = {}
  let pending: Record<string, PendingRecord> = {}
  let curator: CuratorStateRecord | null = null
  if (mounted?.listReviewStates !== undefined) {
    // The mounted provider is authoritative in memory; another host may have
    // written since its last open. Refresh under the same state lock before the
    // snapshot, otherwise the store is built from a stale domain cache.
    await mounted.reload?.()
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
  return { review, curator, pending }
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
  if (await io.exists(storePath)) {
    try {
      const existing = await readStateStoreSnapshot(io, storePath)
      const recovered: StateMigrationResult = {
        reviewSessions: Object.keys(existing.review).length,
        pending: Object.keys(existing.pending).length,
        curator: existing.curator !== null,
        path: storePath,
        dryRun: options.dryRun === true,
      }
      if (options.dryRun === true) return recovered
      if (!(await io.exists(markerPath))) {
        await io.writeText(markerPath, JSON.stringify({
          migratedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
          source: 'domain-store-recovered',
          target: 'store',
          reviewSessions: recovered.reviewSessions,
          pending: recovered.pending,
          curator: recovered.curator,
        }, null, 2) + '\n')
      }
      return recovered
    } catch (error) {
      if (error instanceof Error && error.message.includes('refusing to overwrite')) throw error
      throw new Error('evolution-state-migrate: store already exists; refusing to overwrite it: ' + storePath)
    }
  }
  // Read the legacy domain through one helper shared with the v2 migration.
  const snapshot = await readDomainSnapshot(ctx)
  const review = snapshot.review
  const pending = snapshot.pending
  const curator = snapshot.curator
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

/** Result of the explicit v2 migration; `source` names the authority the document was read from. */
export interface StateV2MigrationResult extends StateMigrationResult {
  readonly commitId: string
  readonly source: 'store' | 'domain' | 'store-v2-recovered'
}

/**
 * Explicit domain/v1 → MVCC migration. The head is the commit point; a marker
 * write that fails after it is recoverable on the next run because the head is
 * already authoritative. No legacy bytes are deleted.
 */
export async function migrateStateToV2(ctx: Context, options: StateMigrationOptions): Promise<StateV2MigrationResult> {
  const home = options.home ?? evolutionHome()
  await mkdir(home, { recursive: true })
  // v1 writers serialize on state.lock; the source read, head bootstrap and
  // marker write must sit inside the same lock or a concurrent v1 save can fall
  // into neither medium.
  return withFileLock(join(home, 'state.lock'), () => migrateStateToV2Unlocked(ctx, { ...options, home }))
}

async function migrateStateToV2Unlocked(ctx: Context, options: StateMigrationOptions): Promise<StateV2MigrationResult> {
  const home = options.home ?? evolutionHome()
  const io = options.io
  const headPath = join(home, 'store-v2', 'head.json')
  const markerPath = join(home, 'state', STATE_V2_MIGRATION_MARKER)
  const fence = options.fence ?? liveHomeFence(ctx, home)
  const kernel = new StoreKernel({ io, home, fence, ...(options.now === undefined ? {} : { now: options.now }) })
  const writeMarker = async (source: StateV2MigrationResult['source'], commitId: string, snapshot: StateStoreSnapshot): Promise<void> => {
    await io.writeText(markerPath, JSON.stringify({
      mode: PROVIDER_STORE_V2,
      generation: options.now?.() ?? Date.now(),
      migratedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
      source,
      target: PROVIDER_STORE_V2,
      commitId,
      lastActiveCommitId: commitId,
      reviewSessions: Object.keys(snapshot.review).length,
      pending: Object.keys(snapshot.pending).length,
      curator: snapshot.curator !== null,
    }, null, 2) + '\n')
  }
  const v1Path = join(home, 'state', 'store.json')
  const source: 'store' | 'domain' = await io.exists(v1Path) ? 'store' : 'domain'
  if (options.stage === true) {
    if (await io.exists(markerPath)) throw new Error('evolution-state-migrate-v2: the v2 migration is already active')
    const snapshot = source === 'store' ? await readStateStoreSnapshot(io, v1Path) : await readDomainSnapshot(ctx)
    if (options.dryRun === true) {
      return {
        reviewSessions: Object.keys(snapshot.review).length,
        pending: Object.keys(snapshot.pending).length,
        curator: snapshot.curator !== null,
        path: headPath,
        dryRun: true,
        commitId: '',
        source,
      }
    }
    const pendingPath = join(home, 'state', STATE_V2_PENDING_MARKER)
    await io.writeText(pendingPath, JSON.stringify({
      target: PROVIDER_STORE_V2,
      stagedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
      source,
      reviewSessions: Object.keys(snapshot.review).length,
      pending: Object.keys(snapshot.pending).length,
      curator: snapshot.curator !== null,
      ...(options.skillsRoot === undefined ? {} : { skillsRoot: options.skillsRoot }),
      ...(options.memoryRoot === undefined ? {} : { memoryRoot: options.memoryRoot }),
      ...(options.discoveryPaths === undefined ? {} : { discoveryPaths: options.discoveryPaths }),
      ...(options.feedbackPath === undefined ? {} : { feedbackPath: options.feedbackPath }),
    }, null, 2) + '\n')
    return {
      reviewSessions: Object.keys(snapshot.review).length,
      pending: Object.keys(snapshot.pending).length,
      curator: snapshot.curator !== null,
      path: headPath,
      dryRun: false,
      commitId: '',
      source,
    }
  }
  if (await io.exists(headPath)) {
    // Production promotion never reaches this: it removes a head that has no
    // active marker before rebootstrap. A head without its marker can only be
    // a hand-rolled/direct call; blessing it would silently drop every other
    // domain's legacy writes after the head was published. Fail loud instead.
    throw new Error('evolution-state-migrate-v2: a v2 head exists without an active marker; refusing to recover it (remove the staged store-v2 directory or re-run the two-stage migration)')
  }

  const snapshot = source === 'store' ? await readStateStoreSnapshot(io, v1Path) : await readDomainSnapshot(ctx)
  if (options.dryRun === true) {
    return {
      reviewSessions: Object.keys(snapshot.review).length,
      pending: Object.keys(snapshot.pending).length,
      curator: snapshot.curator !== null,
      path: headPath,
      dryRun: true,
      commitId: '',
      source,
    }
  }
  const document = { ...emptyStateDocument(), ...snapshot }
  // The run index is a separate legacy medium; migrate it in the same first
  // commit so a v2 run registry never hides pre-migration run history.
  const result = await fence.run(async () => {
    const runsPath = join(home, 'runs.json')
    let runs: RunIndexDocument | undefined
    if (await io.exists(runsPath)) runs = parseRunIndexDocument(await io.readText(runsPath))
    const mergePath = join(home, 'merge', 'merge-state.json')
    const mergeText = await io.exists(mergePath) ? await io.readText(mergePath) : null
    const readDirMap = async (relativeDir: string): Promise<Record<string, string> | undefined> => {
      const dir = join(home, relativeDir)
      if (!existsSync(dir)) return undefined
      const map: Record<string, string> = {}
      for (const name of await io.list(dir)) {
        if (name.startsWith('.')) continue
        const text = await io.readText(join(dir, name))
        if (text !== null) map[`${relativeDir}/${name}`] = text
      }
      return Object.keys(map).length === 0 ? undefined : map
    }
    const mergeMeta = await readDirMap('merge/run-meta')
    const reports = await readDirMap('reports')
    const skillsRoot = options.skillsRoot ?? join(evolutionRoot(), 'skills')
    const usagePath = usageFile(skillsRoot)
    const usageText = await io.exists(usagePath) ? await io.readText(usagePath) : null
    const suppressedPath = suppressedFile(skillsRoot)
    const suppressedText = await io.exists(suppressedPath) ? await io.readText(suppressedPath) : null
    const feedbackPath = options.feedbackPath ?? join(home, 'feedback.json')
    const feedbackText = await io.exists(feedbackPath) ? await io.readText(feedbackPath) : null
    const discoveryPaths = options.discoveryPaths ?? {
      domainMap: join(home, 'domain-map.json'),
      projectionJournal: join(home, 'projection-journal.json'),
      viewSnapshots: join(home, 'view-snapshots.json'),
    } as const
    const discoveryText = async (path: string): Promise<string | null> => await io.exists(path) ? await io.readText(path) : null
    const domainMapText = await discoveryText(discoveryPaths.domainMap)
    const projectionJournalText = await discoveryText(discoveryPaths.projectionJournal)
    const viewSnapshotsText = await discoveryText(discoveryPaths.viewSnapshots)
    const memRoot = options.memoryRoot ?? memoryRoot()
    const memoryText = await discoveryText(join(memRoot, 'MEMORY.md'))
    const userText = await discoveryText(join(memRoot, 'USER.md'))
    return await kernel.bootstrap({
      state: document,
      ...(runs === undefined ? {} : { runs }),
      ...(mergeText === null ? {} : { merge: { text: mergeText } }),
      ...(mergeMeta === undefined ? {} : { mergeMeta }),
      ...(reports === undefined ? {} : { reports }),
      ...(usageText === null ? {} : { usage: { text: usageText } }),
      ...(suppressedText === null ? {} : { suppressed: { text: suppressedText } }),
      ...(feedbackText === null ? {} : { feedback: { text: feedbackText } }),
      ...(domainMapText === null ? {} : { domainMap: { text: domainMapText } }),
      ...(projectionJournalText === null ? {} : { projectionJournal: { text: projectionJournalText } }),
      ...(viewSnapshotsText === null ? {} : { viewSnapshots: { text: viewSnapshotsText } }),
      ...(memoryText === null ? {} : { memoryFile: { text: memoryText } }),
      ...(userText === null ? {} : { userFile: { text: userText } }),
    }, 'bootstrap')
  })
  await writeMarker(source, result.commitId, snapshot)
  return {
    reviewSessions: Object.keys(snapshot.review).length,
    pending: Object.keys(snapshot.pending).length,
    curator: snapshot.curator !== null,
    path: headPath,
    dryRun: false,
    commitId: result.commitId,
    source,
  }
}

/**
 * Promote a staged v2 migration on the next host start.
 *
 * The command writes only `.migrate-store-v2.pending.json`; no v2 head exists
 * while the live host keeps writing legacy media, so there is no window where
 * one domain set has switched and another has not. Promotion runs before any
 * provider/bridge binds, rebuilds the head from the CURRENT legacy bytes (a
 * crash during a previous promotion is discarded, not blessed), then writes the
 * active marker. Idempotent: no pending marker is a no-op.
 */
export async function activatePendingStateV2(ctx: Context, options: StateMigrationOptions): Promise<StateV2MigrationResult | null> {
  const home = options.home ?? evolutionHome()
  const io = options.io
  await mkdir(home, { recursive: true })
  const fence = liveHomeFence(ctx, home)
  // Lock order matches the tree write path: HomeFence first, then state.lock.
  // The fence is passed down so promotion does not request a second authority.
  return await fence.run(async () => withFileLock(join(home, 'state.lock'), async () => {
    const markerPath = join(home, 'state', STATE_V2_MIGRATION_MARKER)
    const pendingPath = join(home, 'state', STATE_V2_PENDING_MARKER)
    if (await io.exists(markerPath)) {
      if (await io.exists(pendingPath)) await io.remove(pendingPath)
      return null
    }
    if (!await io.exists(pendingPath)) return null
    const pending = JSON.parse(await io.readText(pendingPath) ?? '{}') as {
      target?: unknown
      skillsRoot?: string
      memoryRoot?: string
      discoveryPaths?: { domainMap: string; projectionJournal: string; viewSnapshots: string }
      feedbackPath?: string
    }
    if (pending.target !== PROVIDER_STORE_V2) throw new Error('evolution-state-migrate-v2: the staged migration marker is invalid')
    // A head left by a crashed promotion is not authoritative: the active
    // marker was never written, so no v2 consumer could have read it. Remove
    // the staged store and rebuild from the current legacy bytes.
    const headPath = join(home, 'store-v2', 'head.json')
    if (await io.exists(headPath)) await io.remove(headPath)
    for (const dir of ['commits', 'objects']) {
      const path = join(home, 'store-v2', dir)
      if (!existsSync(path)) continue
      for (const name of await io.list(path)) await io.remove(join(path, name))
    }
    const result = await migrateStateToV2Unlocked(ctx, {
      ...options,
      home,
      fence,
      stage: false,
      ...(pending.skillsRoot === undefined ? {} : { skillsRoot: pending.skillsRoot }),
      ...(pending.memoryRoot === undefined ? {} : { memoryRoot: pending.memoryRoot }),
      ...(pending.discoveryPaths === undefined ? {} : { discoveryPaths: pending.discoveryPaths }),
      ...(pending.feedbackPath === undefined ? {} : { feedbackPath: pending.feedbackPath }),
    })
    await io.remove(pendingPath)
    return result
  }))
}

/** The result of an explicit rollback; the v2 bytes stay on disk for inspection. */
export interface StateV2RevertResult {
  readonly reverted: boolean
  readonly generation: number
  readonly lastActiveCommitId?: string | undefined
}

/**
 * Explicit rollback: write a `mode:'legacy'` activation record and let the next
 * host start read the legacy medium. The v2 head/commits are NOT deleted, so an
 * operator can inspect them; they are simply not selected. Writes made while v2
 * was active are not backfilled into legacy files by this function.
 */
export async function revertStateToLegacy(ctx: Context, options: { readonly io: EvolutionIoLike; readonly home?: string; readonly now?: () => number }): Promise<StateV2RevertResult> {
  const home = options.home ?? evolutionHome()
  const current = readStoreActivation(home)
  if (current === null) throw new Error('evolution-state-migrate-v2: there is no v2 activation to revert')
  if (current.mode === 'legacy') {
    return { reverted: false, generation: current.generation, ...(current.lastActiveCommitId === undefined ? {} : { lastActiveCommitId: current.lastActiveCommitId }) }
  }
  const generation = current.generation + 1
  const fence = liveHomeFence(ctx, home)
  await fence.run(async () => withFileLock(join(home, 'state.lock'), async () => {
    await options.io.writeText(storeV2ActivationPath(home), JSON.stringify({
      mode: 'legacy',
      generation,
      ...(current.commitId === undefined ? {} : { commitId: current.commitId, lastActiveCommitId: current.commitId }),
      migratedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
    }, null, 2) + '\n')
  }))
  return { reverted: true, generation, ...(current.commitId === undefined ? {} : { lastActiveCommitId: current.commitId }) }
}
