/**
 * Frozen merge-domain vocabulary. No io, no host, no imports from the plugin shell.
 *
 * The data layer keeps four states; the user face collapses verify/fuse into one retry
 * queue and keeps the stage as a chip. The API queue must never expose the raw state.
 */

export const MERGE_STATE_VERSION = 1

export type MergePairState = 'verify' | 'pending' | 'fuse' | 'skipped'
export type MergeQueue = 'pending' | 'retry' | 'skipped'
export type MergeStage = 'verify' | 'decide' | 'author' | 'commit'
export type MergeCommand = 'scan' | 'pair' | 'approve' | 'resume'

export const MERGE_PAIR_STATES: readonly MergePairState[] = ['verify', 'pending', 'fuse', 'skipped']
export const MERGE_QUEUES: readonly MergeQueue[] = ['pending', 'retry', 'skipped']

/** User-facing queue of one data state. verify/fuse share retry, not two tabs. */
export function queueOf(state: MergePairState): MergeQueue {
  switch (state) {
    case 'pending': return 'pending'
    case 'verify': case 'fuse': return 'retry'
    case 'skipped': return 'skipped'
  }
}

/** Coarse stage chip; skipped has no active stage. */
export function stageOf(state: MergePairState): MergeStage | null {
  switch (state) {
    case 'verify': return 'verify'
    case 'pending': return 'decide'
    case 'fuse': return 'author'
    case 'skipped': return null
  }
}

/** Stable pair identity; NUL cannot appear in a skill name. */
export function pairKey(a: string, b: string): string {
  return a < b ? a + '\u0000' + b : b + '\u0000' + a
}

/** Deterministic, URL-safe id derived from the pair key (FNV-1a 32). */
export function rowIdOf(key: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return 'mr_' + hash.toString(36).padStart(7, '0')
}

export interface MergeFailure {
  readonly stage: 'screening' | 'decide' | 'author' | 'validate' | 'commit'
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly retryFrom: 'agent1' | 'agent2' | 'none'
}

/** One persisted pair. The id is stable for the UI; the pairKey is the natural key. */
export interface MergeRow {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: MergePairState
  readonly queue: MergeQueue
  readonly failure?: MergeFailure
  readonly runId?: string
  readonly unitId?: string
  readonly origin?: 'agent' | 'human'
  readonly attempts?: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MergeState {
  readonly schemaVersion: typeof MERGE_STATE_VERSION
  readonly rows: readonly MergeRow[]
}

export function emptyMergeState(): MergeState {
  return { schemaVersion: MERGE_STATE_VERSION, rows: [] }
}

/** One record can be retried only when the failure says so and names a stage. */
export function canRetry(record: Pick<MergeRow, 'state' | 'failure'>): boolean {
  if (record.state === 'skipped') return false
  if (record.failure === undefined) return record.state !== 'pending'
  return record.failure.retryable && record.failure.retryFrom !== 'none'
}
