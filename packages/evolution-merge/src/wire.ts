/** Merge wire contract v1. Read-only envelopes shared with the client. */
export const WIRE_VERSION = 1 as const

export type QueueId = 'verify' | 'pending' | 'fuse' | 'skipped'
export type WireRowState = 'verify' | 'pending' | 'approved' | 'fuse' | 'skipped'
export type RowStage = 'screening' | 'decide' | 'author' | 'validate' | 'commit'
export type RunStage = RowStage | 'settle'
export type VerifySubState = 'queued' | 'running' | 'failed' | 'cancelled'
export type StagingState = 'none' | 'kept' | 'cleared-source-ok' | 'cleared-source-gone'
export type SkipOrigin = 'agent' | 'human' | 'system'
export type SkipKind = 'agent-keep' | 'human-reject' | 'over-limit' | 'forced'
export type ExpiredKind = 'target-taken' | 'source-changed' | 'source-gone' | 'skipped-ttl'
export type WireRunState =
  | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'awaiting-approval'
  | 'undone' | 'superseded' | 'interrupted' | 'orphan'
export type ActionId =
  | 'approve' | 'reject' | 'retry-candidates' | 'retry-resume' | 'resume' | 'discard'
  | 'restore' | 'pair' | 'status' | 'report' | 'cancel'

export interface MergeCounts {
  readonly active: { readonly verify: number; readonly pending: number; readonly fuse: number; readonly skipped: number }
  readonly expired: number
}
export interface FailureFact {
  readonly stage: RowStage | 'settle'
  readonly code: string
  readonly retryable: boolean
  readonly retryFrom: 'agent1' | 'agent2' | 'none'
  readonly detail?: string
}
export interface SummarySlots { readonly a: string | null; readonly b: string | null; readonly rationale: string | null }
export interface CommandRef { readonly id: string; readonly command: string }
export interface ActionRef {
  readonly id: ActionId
  readonly command: string
  readonly confirm: boolean
  readonly enabled: boolean
  readonly disabledReason?: string
}
export interface RowFact {
  readonly id: string
  readonly state: WireRowState
  readonly queue: QueueId
  readonly verifySubState?: VerifySubState
  /** Optional Batch4 projection; old staging remains compatibility. */
  readonly stage?: 'present' | 'lost' | 'expired'
  readonly a: string
  readonly b: string
  readonly target?: { readonly requested: string; readonly actual?: string; readonly created?: boolean }
  readonly summary?: SummarySlots
  readonly reason?: string
  readonly origin?: SkipOrigin
  readonly skipKind?: SkipKind
  readonly confidence?: number
  readonly failure?: FailureFact
  readonly staging?: { readonly state: StagingState; readonly expiresAt?: number }
  readonly expired?: { readonly kind: ExpiredKind; readonly at: number }
  readonly bodies?: readonly { readonly name: string; readonly side: 'live' | 'archive' }[]
  readonly attempts?: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt?: number
  readonly actions: readonly ActionRef[]
}
export interface Facts {
  readonly wireVersion: 1
  readonly readAt: number
  readonly approval: { readonly mergeApproval: boolean; readonly platformWrite?: boolean }
  readonly counts: MergeCounts
  readonly active: RunView | null
  readonly last: RunView | null
  readonly startCommands: { readonly scan: string; readonly pair: string }
  readonly fallback: readonly CommandRef[]
  readonly notes: readonly string[]
  readonly degraded: boolean
}
export interface QueuePage {
  readonly wireVersion: 1
  readonly readAt: number
  readonly queue: QueueId
  readonly expiredOnly: boolean
  readonly counts: MergeCounts
  readonly rows: readonly RowFact[]
  readonly nextCursor?: string
  readonly notes: readonly string[]
}
export interface RunView {
  readonly wireVersion: 1
  readonly readAt: number
  readonly id: string
  readonly state: WireRunState
  readonly command: 'scan' | 'pair' | 'approve' | 'resume'
  readonly stage?: RunStage
  readonly progress?: { readonly done: number; readonly total: number } | null
  readonly startedAt: number
  readonly endedAt?: number
  readonly stopReason?: string
  readonly failure?: FailureFact
  readonly parentRunId?: string
  readonly currentPairKey?: string
  readonly resultRef?: string
  readonly summary?: {
    readonly merged: number; readonly kept: number; readonly failed: number
    readonly pending: number; readonly cancelled: number
  }
  readonly actions: readonly ActionRef[]
}
export interface RunPair {
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly outcome: 'merged' | 'kept' | 'pending' | 'failed' | 'rejected' | 'cancelled' | 'undone'
  readonly stage?: RowStage
  readonly code?: string
  readonly detail?: string
  readonly target?: { readonly requested: string; readonly actual?: string; readonly created?: boolean }
  readonly actions?: readonly ActionRef[]
}
export interface RunDetail extends RunView { readonly pairs: readonly RunPair[]; readonly pairsTruncated: boolean; readonly meta?: { readonly pairKey?: string; readonly phase?: string; readonly approval?: string }; readonly reportRef?: string }
export interface RunsView { readonly wireVersion: 1; readonly readAt: number; readonly runs: readonly RunView[] }
export interface BodyView {
  readonly wireVersion: 1; readonly readAt: number
  readonly name: string
  readonly side: 'live' | 'archive'; readonly text: string; readonly markdown: boolean
  readonly truncated: boolean; readonly totalBytes: number
}
export interface HistoryItem {
  readonly name: string; readonly kind: 'merged' | 'deleted' | 'split' | 'other'
  readonly reason: string; readonly reasonCode?: string; readonly generation?: number; readonly lastVersion: number; readonly archivedAt: number; readonly sourceRunId?: string; readonly runId?: string; readonly absorbedInto?: string
}
export interface HistoryView { readonly wireVersion: 1; readonly readAt: number; readonly items: readonly HistoryItem[] }
export interface DoctorFact {
  readonly key: string; readonly status: 'ok' | 'warn' | 'fail' | 'unknown'
  readonly code?: string; readonly count?: number; readonly detail?: string
}
export interface DoctorView {
  readonly wireVersion: 1; readonly readAt: number; readonly counts: MergeCounts
  readonly latestRun?: RunView
  readonly staging: {
    readonly state: 'ok' | 'absent' | 'unreadable'
    readonly dirs: number; readonly oldestAgeMs?: number; readonly detail?: string
  }
  readonly approval: { readonly mergeApproval: boolean; readonly writeApproval?: boolean }
  readonly hostOnly?: { readonly code: 'E-323'; readonly detail?: string }
  /** Set when the read model cannot read the merge state; the rows are empty placeholders. */
  readonly blocked?: { readonly code: string; readonly message: string }
  readonly rows: readonly DoctorFact[]
}
export interface WireFailure { readonly wireVersion: 1; readonly readAt?: number; readonly code: string; readonly message?: string }
export interface CommandFlagSpec {
  readonly name: string; readonly kind: 'boolean' | 'value'; readonly valueName?: string
  readonly required?: boolean; readonly repeatable?: boolean; readonly values?: readonly string[]
}
export interface CommandPositionalSpec {
  readonly name: string; readonly kind: 'skill' | 'target' | 'runId' | 'id' | 'json' | 'text'
  readonly required: boolean; readonly variadic?: boolean
}
export interface CommandActionRule {
  readonly id: ActionId; readonly command: string
  readonly confirm?: boolean; readonly enabledWhen?: string
}
export interface CommandSpec {
  readonly id: string; readonly words: readonly string[]; readonly flags: readonly CommandFlagSpec[]
  readonly positional: readonly CommandPositionalSpec[]; readonly summary: string
  readonly readOnly: boolean; readonly needsRun: boolean; readonly defaults: Readonly<Record<string, string>>
  readonly rowActions: readonly CommandActionRule[]; readonly fallback: string
}
export interface CommandSurface {
  readonly wireVersion: 1; readonly prefix: '/evolution merge'
  readonly commands: readonly CommandSpec[]; readonly fallback: readonly CommandRef[]
}
