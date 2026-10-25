/**
 * Frozen merge-domain vocabulary. No io, no host, no imports from the plugin shell.
 *
 * The data layer keeps four states; the user face collapses verify/fuse into one retry
 * queue and keeps the stage as a chip. The API queue must never expose the raw state.
 */

export const MERGE_STATE_VERSION = 3

export type MergePairState = 'verify' | 'pending' | 'approved' | 'fuse' | 'skipped'
export type MergeQueue = 'verify' | 'pending' | 'fuse' | 'skipped'
export type MergeStage = 'verify' | 'decide' | 'author' | 'commit'
export type MergeCommand = 'scan' | 'pair' | 'approve' | 'resume'

export const MERGE_PAIR_STATES: readonly MergePairState[] = ['verify', 'pending', 'approved', 'fuse', 'skipped']
export const MERGE_QUEUES: readonly MergeQueue[] = ['verify', 'pending', 'fuse', 'skipped']

/** User-facing queue of one data state. verify/fuse share retry, not two tabs. */
export function queueOf(state: MergePairState): MergeQueue {
  switch (state) {
    case 'verify': return 'verify'
    case 'pending': return 'pending'
    case 'approved': case 'fuse': return 'fuse'
    case 'skipped': return 'skipped'
  }
}

/** Coarse stage chip; skipped has no active stage. */
export function stageOf(state: MergePairState): MergeStage | null {
  switch (state) {
    case 'verify': return 'verify'
    case 'pending': return 'decide'
    case 'approved': case 'fuse': return 'author'
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
  readonly lengths?: Readonly<Record<string, number>>
}

/** One persisted pair. The id is stable for the UI; the pairKey is the natural key. */
export interface MergeGateFact {
  readonly level: 'L0' | 'L1' | 'L2'
  readonly verdict: 1 | 0 | -1
  readonly reason: string
  readonly cached?: boolean
  readonly auditOverride?: boolean
}

export interface MergeCandidate {
  readonly a: string
  readonly b: string
  readonly score?: number
  readonly arms?: readonly string[]
  readonly reason?: string
  readonly gate?: MergeGateFact
  readonly source?: 'lexical' | 'proposed' | 'engine'
}

export type RevisionRef = { readonly kind: 'absent' } | { readonly kind: 'present'; readonly sha256: string }

export interface MergeDecision {
  readonly shouldMerge: boolean
  readonly mode: 'merge-into-existing' | 'create-umbrella' | 'keep'
  readonly target: string
  readonly sources: readonly string[]
  readonly rationale: string
  readonly confidence?: number
  readonly promptVersion?: string
  readonly promptHash?: string
  readonly aSummary?: string
  readonly bSummary?: string
  readonly cacheRead?: number
  readonly targetRevisionRef?: RevisionRef
  readonly sourceRevisionRef?: RevisionRef
  /** Per-source anchors recorded with the decision; a commit re-checks each one. */
  readonly sourceRevisions?: Readonly<Record<string, RevisionRef>>
  readonly supportDigest?: string
}

export interface MergeValidationPlanRef { readonly planVersion: 1; readonly stageDigest: string; readonly revision: string }

export interface MergeUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly costCny?: number
}

export interface MergeTiming {
  readonly screeningMs?: number
  readonly gateMs?: number
  readonly agentMs?: number
  readonly commitMs?: number
}

export type MergeRunCommand = MergeCommand

export interface MergeReportPair {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly queue: MergeQueue
  readonly candidate?: MergeCandidate
  readonly gate?: MergeGateFact
  readonly decision?: MergeDecision
  readonly outcome: 'merged' | 'kept' | 'pending' | 'failed' | 'cancelled'
  readonly target?: { readonly requested: string; readonly actual: string; readonly created: boolean }
  readonly archived: readonly string[]
  readonly unitId?: string
  readonly failure?: MergeFailure
  readonly usage?: MergeUsage
  readonly lengths?: Readonly<Record<string, number>>
  readonly timing?: MergeTiming
  readonly validationPlan?: MergeValidationPlanRef
  readonly criteria?: MergeCriteria
  readonly reportOnly?: boolean
}
export interface MergeCriteria { readonly decision: 'keep' | 'merge' | 'candidate'; readonly validation: 'not-run' | 'report-only' | 'required'; readonly commit: 'never' | 'if-approved' | 'required'; readonly archive: 'none' | 'sources'; readonly evidence: 'none' | 'receipt' }

export interface MergeReport {
  readonly schemaVersion: 2
  readonly runId: string
  readonly kind: 'merge'
  readonly command: MergeRunCommand
  readonly startedAt: number
  readonly endedAt: number
  readonly stopReason: 'completed' | 'failed' | 'cancelled' | 'timeout'
  readonly approval: { readonly platformWrite: boolean; readonly mergeApproval: boolean }
  readonly scope: { readonly candidatePairs: number; readonly queueBefore: Record<MergeQueue, number> }
  readonly pairs: readonly MergeReportPair[]
  readonly totals: Record<'merged' | 'kept' | 'pending' | 'failed', number>
  readonly notes: readonly string[]
  readonly remaining?: readonly { readonly pairKey: string; readonly queue: MergeQueue }[]
  readonly reportOnly?: readonly MergeReportPair[]
  readonly validationFailures?: readonly MergeReportPair[]
  readonly archived?: readonly string[]
  readonly commit?: { readonly unitId?: string; readonly target?: string; readonly created?: boolean }
  readonly usage?: MergeUsage
  readonly timing?: MergeTiming
  readonly criteria?: readonly MergeCriteria[]
}

export interface MergeRow {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: MergePairState
  readonly queue: MergeQueue
  readonly expired?: 'target-taken' | 'source-changed'
  readonly reason?: string
  readonly target?: { readonly requested: string; readonly actual?: string; readonly created?: boolean }
  readonly failure?: MergeFailure
  /** Round-1 decision, persisted for the later approve round. */
  readonly decision?: MergeDecision
  readonly sourceRevision?: string
  readonly targetRevision?: string
  readonly sourceRevisionRef?: RevisionRef
  readonly targetRevisionRef?: RevisionRef
  readonly runId?: string
  readonly unitId?: string
  readonly origin?: 'agent' | 'human' | 'system'
  readonly attempts?: number
  readonly stagingRef?: string
  readonly stagingExpiresAt?: number
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
export const MERGE_MAX_ATTEMPTS = 3

export function canRetry(record: Pick<MergeRow, 'state' | 'failure' | 'attempts'>): boolean {
  if (record.state === 'skipped') return false
  if ((record.attempts ?? 0) >= MERGE_MAX_ATTEMPTS) return false
  if (record.failure === undefined) return record.state !== 'pending'
  return record.failure.retryable && record.failure.retryFrom !== 'none'
}
