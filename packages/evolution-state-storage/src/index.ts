/**
 * Provider seam for durable evolution state.
 *
 * The state CONSUMER (`@deepseek-ai/dsh-evolution-state`) never touches a
 * medium. Providers register here: `domain` (storage-domain KV) and `json`
 * (IO-seam files) are the two shipped providers.
 * @module @deepseek-ai/dsh-evolution-state-storage
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** 0.3.17 (S3.5, D-4): 'skill_batch' removed — nothing ever created one
 * (dead enum member); the historic value, if it ever reached disk, is read as
 * an unknown kind by consumers rather than minted here. */
export type PendingKind = 'memory' | 'skill' | 'capability'
/** 0.3.17 (S3.3, E-24): 'executing' = claimed, runner in flight — a fresh
 * claim only takes 'pending', and resolve accepts 'pending'/'executing', so a
 * crash mid-approve can never double-execute the runner. */
export const PENDING_STATUSES = ['pending', 'executing', 'approved', 'rejected'] as const
export type PendingStatus = (typeof PENDING_STATUSES)[number]

/** 0.3.17 (S3.3): the claim lifecycle as ONE transition table — BOTH
 * providers (json/domain) must use these, never a hand-written copy (a second
 * copy is exactly the E-10 drift class). */
export const canClaimPending = (status: PendingStatus): boolean => status === 'pending'
export const canResolvePending = (status: PendingStatus): boolean => status === 'pending' || status === 'executing'
/** Releasing a claim on an executing record rolls it back to pending (a
 * runner FAILURE is retryable); other statuses pass through unchanged. */
export const releasedStatus = (status: PendingStatus): PendingStatus => status === 'executing' ? 'pending' : status

/**
 * Claim lifecycle (S3.3): pending →(claim)→ executing →(resolve)→ approved/rejected.
 * release() rolls executing back to pending (failure path). A crash between
 * the runner execution and the resolve leaves the record executing+claimed:
 * until expiry another claim is refused (no double execution), and after
 * expiry only the operator acts — approval NEVER auto-replays an executing
 * record (the write may already have landed; a non-idempotent replay would
 * duplicate it). Operator options: reject (cleanup, no runner) or release +
 * re-stage after manual verification. Release command surface is deferred.
 */

/** 0.3.17 (E-75): claim expiry single source — both providers (json/domain)
 * previously hardcoded `10 * 60_000` independently. */
export const CLAIM_EXPIRY_MS = 10 * 60_000

export interface ReviewStateRecord {
  turnsSinceMemory: number
  turnsSinceSkill: number
  lastTurn: number
}

export interface CuratorStateRecord {
  lastRunAt: number
  runCount: number
  lastSummary: string
  paused: boolean
}

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
  /** 0.3.17 (E-25): who staged this (foreground vs background review) and
   * which session — kept so resolved audit history is attributable. */
  origin?: string | undefined
  sessionId?: string | undefined
}

export interface PendingResolution {
  record: PendingRecord | null
  applied: boolean
}

export interface EvolutionStateStorage {
  readonly name: string
  loadReviewState(sessionId: string): Promise<ReviewStateRecord | null>
  saveReviewState(sessionId: string, record: ReviewStateRecord): Promise<void>
  loadCuratorState(): Promise<CuratorStateRecord | null>
  saveCuratorState(record: CuratorStateRecord): Promise<void>
  listPending(status?: PendingStatus): Promise<PendingRecord[]>
  savePending(record: PendingRecord): Promise<void>
  /** Atomically transition a pending record exactly once. */
  tryResolvePending(id: string, status: Exclude<PendingStatus, 'pending'>): Promise<PendingResolution>
  /** Atomically mark a pending record as claimed by one approver, or return null. */
  claimPending(id: string, claimId: string): Promise<PendingRecord | null>
  /** Release this claim when the replay runner cannot complete. */
  releasePendingClaim(id: string, claimId: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionStateStorage: EvolutionStateStorageRegistry
  }
}

export class EvolutionStateStorageRegistry extends Service {
  private readonly providers = new Map<string, EvolutionStateStorage>()

  constructor(ctx: Context) {
    super(ctx, 'evolutionStateStorage')
  }

  registerProvider(provider: EvolutionStateStorage): () => void {
    if (this.providers.has(provider.name)) throw new Error(`evolution state storage provider "${provider.name}" already registered`)
    this.providers.set(provider.name, provider)
    return () => {
      if (this.providers.get(provider.name) === provider) this.providers.delete(provider.name)
    }
  }

  provider(name?: string): EvolutionStateStorage {
    if (name) {
      const provider = this.providers.get(name)
      if (provider) return provider
      throw new Error(`evolution state storage provider "${name}" is not registered`)
    }
    const first = this.providers.values().next().value
    if (!first) throw new Error('no evolution state storage provider registered; mount @deepseek-ai/dsh-evolution-state-json or @deepseek-ai/dsh-evolution-state-domain')
    return first
  }
}

export default EvolutionStateStorageRegistry
