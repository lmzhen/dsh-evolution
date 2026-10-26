/** Pure merge-kernel model. No IO, no host, no clock. */
export type PairState =
  | 'candidate'
  | 'deciding'
  | 'pending'
  | 'approved'
  | 'authoring'
  | 'staged'
  | 'committing'
  | 'committed'
  | 'closed'
  | 'expired'
  | 'failed'
  | 'cancelled'
  | 'undone'
  | 'superseded'
  | 'unknown'

export type ClosedReason = 'keep' | 'reject' | 'over-limit'
export type ApprovalState = 'on' | 'off'
export type FailureStage = 'command' | 'screen' | 'decide' | 'author' | 'validate' | 'commit' | 'run' | 'surface' | 'schema'

export type FailureCode =
  | 'bad-pair'
  | 'bad-target'
  | 'bad-flag'
  | 'source-gone'
  | 'source-changed'
  | 'target-taken'
  | 'validation-failed'
  | 'commit-failed'
  | 'schema-invalid'
  | 'timeout'
  | 'capability-missing'
  | 'runtime'

export interface Failure {
  readonly code: FailureCode
  readonly stage: FailureStage
  readonly retryable: boolean
  readonly reportOnly: boolean
  readonly userMessageKey: string
  readonly detail?: string
}

export interface MergeDecision {
  readonly target: string
  readonly sources: readonly string[]
  readonly rationale?: string
}

export interface CommitReceipt {
  readonly unitId: string
  readonly evidenceSha256: string
  readonly targetRevision?: string
  readonly sourceRevisions?: Readonly<Record<string, string>>
}

export type RunState = 'queued' | 'screening' | 'deciding' | 'awaiting-approval' | 'authoring' | 'committing' | 'settled' | 'failed' | 'cancelled' | 'recovering'

export interface SkillSnapshot {
  readonly name: string
  readonly revision: string
  readonly protection?: 'managed' | 'bundled' | 'hub' | 'pinned' | 'protected' | 'unknown'
}

export interface Candidate {
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly evidenceSeq: readonly number[]
  readonly score?: number
}

export interface RunSnapshot {
  readonly id: string
  readonly state: RunState
  readonly version: number
  readonly pairs: readonly string[]
  readonly startedAt: string
  readonly updatedAt: string
}

export interface UnitEffect {
  readonly kind: 'skill' | 'usage' | 'staging' | 'report'
  readonly ref: string
}

export interface UnitPlan {
  readonly unitId: string
  readonly pairKey: string
  readonly target: string
  readonly sources: readonly string[]
  readonly effects: readonly UnitEffect[]
}

export interface PairSnapshot {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: PairState
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly origin?: 'agent' | 'human' | 'system'
  readonly runId?: string
  readonly target?: string
  readonly decision?: MergeDecision
  readonly approval?: ApprovalState
  readonly failure?: Failure
  readonly closedReason?: ClosedReason
  readonly stageRef?: string
  readonly unitId?: string
  readonly expiresAt?: number
  readonly receipt?: CommitReceipt
  readonly attempts: number
}

export type PairEvent =
  | { readonly type: 'screen'; readonly at: string }
  | { readonly type: 'decide'; readonly at: string; readonly decision: 'merge' | 'keep'; readonly approval: ApprovalState; readonly target?: string; readonly runId?: string }
  | { readonly type: 'approve'; readonly at: string }
  | { readonly type: 'reject'; readonly at: string }
  | { readonly type: 'author-start'; readonly at: string }
  | { readonly type: 'staged'; readonly at: string; readonly stageRef: string }
  | { readonly type: 'commit-start'; readonly at: string; readonly unitId: string }
  | { readonly type: 'commit-succeeded'; readonly at: string; readonly receipt: CommitReceipt }
  | { readonly type: 'commit-failed'; readonly at: string; readonly failure: Failure }
  | { readonly type: 'commit-unknown'; readonly at: string; readonly reason: string }
  | { readonly type: 'recover'; readonly at: string; readonly outcome: 'committed' | 'failed' | 'cancelled'; readonly receipt?: CommitReceipt; readonly failure?: Failure }
  | { readonly type: 'close'; readonly at: string; readonly reason: ClosedReason }
  | { readonly type: 'expire'; readonly at: string; readonly reason: 'pending-ttl' | 'staging-ttl' }
  | { readonly type: 'cancel'; readonly at: string }
  | { readonly type: 'fail'; readonly at: string; readonly failure: Failure }
  | { readonly type: 'retry'; readonly at: string }
  | { readonly type: 'undo'; readonly at: string }
  | { readonly type: 'supersede'; readonly at: string }

export const TERMINAL_STATES: readonly PairState[] = ['closed', 'expired', 'cancelled', 'committed', 'undone', 'superseded']
export const ACTIVE_STATES: readonly PairState[] = ['candidate', 'deciding', 'pending', 'approved', 'authoring', 'staged', 'committing', 'unknown']
export const ALL_STATES: readonly PairState[] = [...ACTIVE_STATES, ...TERMINAL_STATES]
export const CLOSED_REASONS: readonly ClosedReason[] = ['keep', 'reject', 'over-limit']
