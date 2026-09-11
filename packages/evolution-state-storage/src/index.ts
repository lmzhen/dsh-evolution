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
// P2-12/14/15/16/18 (v19): the record contract both providers consume.
export * from './record-contract.ts'

/** 0.3.17 (S3.5, D-4): 'skill_batch' removed — nothing ever created one
 * (dead enum member); the historic value, if it ever reached disk, is read as
 * an unknown kind by consumers rather than minted here.
 *
 * 0.3.66: 'capability' is retained with NO producer — the evolution-capability
 * adapter was removed. It is a read-compatibility member: state written by an
 * install that used that adapter (≤0.3.65) still holds such records, and they
 * must keep loading, listing in `/evolution pending`, and answering approve or
 * reject. Dropping it would strand them two ways: json quarantines the row to
 * `<file>.corrupt` and refuses the resolving write, while the domain provider
 * validates every stored record at mount, so one such row fails the whole domain
 * with `invalid-record`. */
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
 * V24-08 (v24): session rows in the review-state table, per session id. The
 * review pipeline saves on EVERY turn/end of EVERY session and nothing ever
 * deleted rows, so the file grew (and was fully rewritten) with the deploy's
 * whole session history — the same unbounded-growth class the pending cap
 * above already fixed for approvals. A review row is advisory cadence state:
 * evicting the least-recently-active session merely lets that session's next
 * review fire from a fresh counter, so a generous cap is loss-less in
 * practice. Enforced by BOTH providers inside their save path (no seam
 * interface change, no background sweeper).
 */
export const REVIEW_STATE_SESSION_CAP = 500

/**
 * V27 G2.2: WHICH pending records the audit cap evicts, as one pure rule both
 * providers apply (the two implementations had drifted into separate files and
 * only one of them was ever updated by a later fix).
 *
 * Eligible = resolved (`approved`/`rejected`) and NOT a capability approval:
 * v23 (AP-1) exempts those because the Creator-mode contract reads the LIVE
 * approved list and a capability cannot be re-submitted for the same package,
 * so eviction would make an approved capability permanently unactivatable.
 * Ordering = oldest `resolvedAt` first; a missing or unparseable timestamp sorts
 * LAST (json parity, v16) — an unknown time must never make a record the victim,
 * and pending/executing rows are live work that is never trimmed.
 *
 * @param records - every pending record currently in the live table.
 * @param cap - how many resolved records may be kept.
 * @returns the records to evict, oldest first (empty when within the cap).
 */
export function selectPendingOverflow(
  records: readonly PendingRecord[],
  cap: number = PENDING_RESOLVED_CAP,
): PendingRecord[] {
  const resolved = records.filter(record =>
    (record.status === 'approved' || record.status === 'rejected') && record.kind !== 'capability')
  const overflow = resolved.length - cap
  if (overflow <= 0) return []
  const resolvedAtMs = (record: PendingRecord): number => {
    if (!record.resolvedAt) return Number.MAX_SAFE_INTEGER
    const parsed = Date.parse(record.resolvedAt)
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
  }
  return [...resolved].sort((a, b) => resolvedAtMs(a) - resolvedAtMs(b)).slice(0, overflow)
}

/**
 * V27 G2.2: which review-state session rows a save evicts, as one pure rule
 * both providers apply. The saving session is never a candidate (it is the most
 * recent write by definition); the rest are ordered by their provider stamp
 * ascending, with a missing stamp read as 0 = oldest, because an active session
 * re-stamps its row on its next save and an unknown stamp is stale by
 * construction. Exactly one row is dropped per over-cap save, which keeps the
 * table at the cap in steady state.
 *
 * @param rows - the other sessions' rows, with their stamps.
 * @param cap - how many session rows may exist.
 * @returns the keys to delete, oldest first.
 */
export function selectSessionOverflow<T>(
  rows: readonly T[],
  options: { keyOf(row: T): string; stampOf(row: T): number },
  cap: number = REVIEW_STATE_SESSION_CAP,
): string[] {
  const overflow = rows.length - cap + 1
  if (overflow <= 0) return []
  return [...rows]
    .sort((a, b) => options.stampOf(a) - options.stampOf(b))
    .slice(0, overflow)
    .map(row => options.keyOf(row))
}

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
   *
   * V27 S4: the record handed to `task` belongs to the task — a provider must
   * NEVER pass the object it stores (both current providers hand out a copy:
   * json re-parses its medium, the domain clones its record). Mutating the
   * argument is not a supported way to write: a task that does so and then lets
   * validation refuse the result would otherwise leave a mutated object in the
   * provider's in-memory store.
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
