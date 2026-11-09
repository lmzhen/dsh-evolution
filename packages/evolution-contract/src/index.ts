/**
 * Cross-package contracts for the dsh-evolution family.
 *
 * This package is intentionally a library: it declares state and event shapes,
 * not a Cordis plugin. It must not import any evolution implementation package.
 *
 * @module @deepseek-ai/dsh-evolution-contract
 */

import type {} from '@deepseek-ai/cordis'

/** One platform service the family probes, with the feature that degrades without it. */
export interface PlatformServiceProbe {
  /** The service key as `ctx.get` spells it. */
  readonly service: string
  /** The family feature that degrades when the service is absent. */
  readonly feature: string
  /** Where the probe runs. */
  readonly side: 'host' | 'client'
}

/** Versioned process-bus event payload; consumers must tolerate unknown versions. */
export interface EvolutionEvent<TPayload = unknown> {
  readonly name: string
  readonly version: 1
  readonly payload: TPayload
}

/** A lifecycle service implemented by a capability package. */
export interface EvolutionLifecycleService {
  /** Stable service name used in diagnostics. */
  readonly name: string
}

/** Legal kind of one pending write. The runtime source stays in state-storage. */
export type PendingKind = 'memory' | 'skill' | 'capability'

/** Legal status of one pending write. */
export type PendingStatus = 'pending' | 'executing' | 'approved' | 'rejected'

/** Terminal outcome of one review/merge/curator run; audit and UI must use this vocabulary. */
export type RunOutcome = 'applied' | 'staged' | 'partial' | 'no-op' | 'degraded' | 'aborted' | 'failed'

/** Who owns a durable mutation; foreground user work and background review are distinct authorities. */
export type MutationOwner = 'foreground' | 'background_review'

/** Per-session review counters. */
export interface ReviewStateRecord {
  turnsSinceMemory: number
  turnsSinceSkill: number
  lastTurn: number
}

/** Curator bookkeeping record. */
export interface CuratorStateRecord {
  lastRunAt: number
  runCount: number
  lastSummary: string
  paused: boolean
}

/** One pending write. */
export interface PendingRecord {
  id: string
  kind: PendingKind
  summary: string
  args: unknown
  createdAt: string
  status: PendingStatus
  resolvedAt?: string | undefined
  claimedBy?: string | undefined
  claimedAt?: string | undefined
  origin?: string | undefined
  sessionId?: string | undefined
  decidedBy?: { readonly channel: 'connection.fetch' | 'command'; readonly principal: 'owner'; readonly deploymentAllowsRemote: boolean } | undefined
}

/** Result of one atomic pending transition. */
export interface PendingResolution {
  record: PendingRecord | null
  applied: boolean
}

/** Provider seam for durable evolution state; implementations own the medium. */
export interface EvolutionStateStorage {
  readonly name: string
  loadReviewState(sessionId: string): Promise<ReviewStateRecord | null>
  saveReviewState(sessionId: string, record: ReviewStateRecord): Promise<void>
  loadCuratorState(): Promise<CuratorStateRecord | null>
  saveCuratorState(record: CuratorStateRecord): Promise<void>
  transactCuratorState(task: (current: CuratorStateRecord | null) => CuratorStateRecord | null): Promise<void>
  listPending(status?: PendingStatus): Promise<PendingRecord[]>
  savePending(record: PendingRecord): Promise<void>
  tryResolvePending(id: string, status: Exclude<PendingStatus, 'pending'>, expectedClaimId?: string): Promise<PendingResolution>
  claimPending(id: string, claimId: string): Promise<PendingRecord | null>
  releasePendingClaim(id: string, claimId: string): Promise<void>
}

/** Outcome counts of one reviewed plan write leg. */
export interface EvolutionPlanAppliedEvent {
  sessionId: string
  planId: string
  policyFingerprint?: string | undefined
  memoryApplied: number
  skillApplied: number
  rejectedOps: number
  stagedOps?: number | undefined
  executionFailures?: number | undefined
  skippedUnread?: number | undefined
  executionError?: string | undefined
  evidenceClassReports?: number | undefined
  evidenceQuotes?: number | undefined
  estimatedInputChars?: number | undefined
}

/** One skill mutation announcement. */
export interface EvolutionSkillMutatedEvent {
  action: string
  name: string
  skillDir?: string
  file?: string
  archivedPath?: string
}
