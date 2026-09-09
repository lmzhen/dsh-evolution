/**
 * Provider seam for durable evolution state.
 *
 * The state CONSUMER (`@deepseek-ai/dsh-evolution-state`) never touches a
 * medium. Providers register here: `domain` (storage-domain KV) and `json`
 * (IO-seam files) are the two shipped providers.
 * @module @deepseek-ai/dsh-evolution-state-storage
 */

import { Context, Service } from '@deepseek-ai/cordis'

// S-06: the state-stack magic strings (singleton key, file names,
// provider names, table names) are single-sourced here.
export * from './constants.ts'

/** 0.3.17 (S3.5, D-4): 'skill_batch' removed — nothing ever created one
 * (dead enum member); the historic value, if it ever reached disk, is read as
 * an unknown kind by consumers rather than minted here. */
export type PendingKind = 'memory' | 'skill' | 'capability'
/** 0.3.17 (S3.3, E-24): 'executing' = claimed, runner in flight — a fresh
 * claim only takes 'pending', and resolve accepts 'pending'/'executing', so a
 * crash mid-approve can never double-execute the runner. */
export type PendingStatus = 'pending' | 'executing' | 'approved' | 'rejected'

/** 0.3.17 (S3.3): the claim lifecycle as ONE transition table — BOTH
 * providers (json/domain) must use these, never a hand-written copy (a second
 * copy is exactly the E-10 drift class). */
export const canClaimPending = (status: PendingStatus): boolean => status === 'pending'
export const canResolvePending = (status: PendingStatus): boolean => status === 'pending' || status === 'executing'
/** Releasing a claim on an executing record rolls it back to pending (a
 * runner FAILURE is retryable); other statuses pass through unchanged. */
export const releasedStatus = (status: PendingStatus): PendingStatus => status === 'executing' ? 'pending' : status

/** P2-4 (v15): the live pending map/table is BOUNDED on the RESOLVE path —
 * `tryResolvePending` drops the oldest resolved (approved/rejected) records by
 * `resolvedAt` once more than this many exist. Single source (the v15 audit
 * found the bound was json-only, so domain deployments grew the table without
 * bound).
 *
 * C-6 (v18) contract precision: a direct `savePending` of an already-resolved
 * record does NOT trigger eviction (the cap is maintained by the resolve
 * operation, not by the writer), and pending/executing records are never
 * trimmed. Callers that write resolved audit records themselves own that
 * growth; the seam's resolve path is what keeps the table bounded.
 * The audit ARCHIVE sidecar that json maintains beyond the cap stays
 * json-specific (domain has no sidecar facility) — declared in both READMEs. */
export const PENDING_RESOLVED_CAP = 200

/**
 * Claim lifecycle (S3.3): pending →(claim)→ executing →(resolve)→ approved/rejected.
 * release() rolls executing back to pending (failure path). A crash between
 * the runner execution and the resolve leaves the record executing+claimed,
 * and NO later claim is ever accepted (claim only takes pending, so a crashed
 * approve can never double-execute a non-idempotent runner). Only the operator
 * acts on such a record: reject (cleanup, no runner) or release + re-stage
 * after manual verification. Release command surface is deferred.
 */

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
  /**
   * Atomically read-modify-write the curator-state record (S5.5): `task`
   * receives the current record (or null when none exists) and returns the
   * next record; returning null keeps the current record unchanged (the
   * domain update primitive cannot delete, and json aligns with it). The
   * whole read → transform → write runs inside one provider transact, so a
   * setPaused racing the run-core bookkeeping write can never interleave a
   * stale load with a newer save.
   */
  transactCuratorState(task: (current: CuratorStateRecord | null) => CuratorStateRecord | null): Promise<void>
  listPending(status?: PendingStatus): Promise<PendingRecord[]>
  savePending(record: PendingRecord): Promise<void>
  /**
   * Atomically transition a pending record exactly once.
   * @param expectedClaimId - when given, the transition applies only while the
   * record is STILL claimed by this approver (P2-2, v14). A record resolved or
   * re-claimed by another writer is left untouched and reported as
   * `applied: false`, so an approve can never overwrite a concurrent reject.
   */
  tryResolvePending(id: string, status: Exclude<PendingStatus, 'pending'>, expectedClaimId?: string): Promise<PendingResolution>
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
  /** C-7 (v18): per-name dispose, mirroring the evolution-io registry. */
  private readonly disposals = new Map<string, () => void>()

  constructor(ctx: Context) {
    super(ctx, 'evolutionStateStorage')
  }

  /** C-7 (v18): re-registering the IDENTICAL provider object is idempotent and
   * returns the original dispose (HMR / re-mounted row); a DIFFERENT object
   * under a registered name still fails loud. The dispose carries a generation
   * guard so a stale handle cannot remove a newer registration. */
  registerProvider(provider: EvolutionStateStorage): () => void {
    const idempotent = this.providers.get(provider.name) === provider
    if (!idempotent && this.providers.has(provider.name)) throw new Error(`evolution state storage provider "${provider.name}" already registered`)
    if (idempotent) {
      const existing = this.disposals.get(provider.name)
      if (existing !== undefined) return existing
    }
    const dispose = (): void => {
      if (this.disposals.get(provider.name) !== dispose) return
      this.providers.delete(provider.name)
      this.disposals.delete(provider.name)
    }
    this.providers.set(provider.name, provider)
    this.disposals.set(provider.name, dispose)
    return dispose
  }

  /** S-07: whether ANY provider is registered. Lets the state
   * consumer precheck a pinned `provider` config at mount time (a typo fails
   * at start with the registry's precise message) while staying lazy when no
   * provider has registered yet (mount order not settled). */
  hasProviders(): boolean {
    return this.providers.size > 0
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
