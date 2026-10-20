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

/** Stable pair identity; skill names are lowercase-hyphenated, so '|' is safe. */
export function pairKey(a: string, b: string): string {
  return a < b ? a + '|' + b : b + '|' + a
}

export interface MergeFailure {
  readonly stage: 'screening' | 'decide' | 'author' | 'validate' | 'commit'
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly retryFrom: 'agent1' | 'agent2' | 'none'
}

export interface MergePairRecord {
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: MergePairState
  readonly failure?: MergeFailure
  readonly runId?: string
  readonly unitId?: string
  readonly origin?: 'agent' | 'human'
  readonly updatedAt: string
}

export interface MergeState {
  readonly schemaVersion: typeof MERGE_STATE_VERSION
  readonly pairs: Record<string, MergePairRecord>
}

export function emptyMergeState(): MergeState {
  return { schemaVersion: MERGE_STATE_VERSION, pairs: {} }
}

/** One record can be retried only when the failure says so and names a stage. */
export function canRetry(record: MergePairRecord): boolean {
  if (record.state === 'skipped') return false
  if (record.failure === undefined) return record.state !== 'pending'
  return record.failure.retryable && record.failure.retryFrom !== 'none'
}
