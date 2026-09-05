/**
 * Stage/pending write approval for self-evolution mutations.
 *
 * DSH's native approval seam is one-shot only. This service adds the
 * Hermes-style staged queue: background review/curator writes are stored in
 * `ctx.evolutionState`, and a human approves or rejects them later. A runner
 * registry replays the exact mutation without passing through the gate a
 * second time. Resolved records are kept as audit history up to
 * PENDING_RESOLVED_CAP (the most recent N; the state provider archives the
 * older ones to pending-state-archive.json).
 *
 * @module @deepseek-ai/dsh-evolution-approval
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { PendingKind, PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import type {} from '@deepseek-ai/dsh-evolution-state'

export type { PendingKind, PendingRecord, PendingStatus }

export type WriteRunner = (args: unknown) => Promise<{ ok: boolean; message: string }>

export interface ApprovalRequest {
  kind: PendingKind
  summary: string
  args: unknown
  origin: 'foreground' | 'background_review'
  /**
   * The requesting session's effective approval policy (platform vocabulary:
   * 'ask' | 'never' — see `dsh-user-approval`). When 'never', the session has
   * declared the deterministic unattended stance (CI, cron, automated runs),
   * so the write is allowed instead of staging an unanswerable pending record
   * (claw alignment: "skip approval for non-interactive contexts"). Absent
   * (no session / no approval service) keeps the previous behavior.
   */
  sessionPolicy?: 'ask' | 'never'
  /** 0.3.17 (E-25): the requesting session id, kept on the record for
   * audit attribution (staged AND resolved history). */
  sessionId?: string
}

export interface ApprovalDecision {
  action: 'allow' | 'staged'
  pendingId?: string
  message: string
}

/** 0.3.19 (W1.2): the ONE consumer-facing shape of the approval seam. Every
 * package that probes `ctx.get('evolutionApproval')` imports this instead of
 * declaring a local sub-interface (previously 5 duplicated local views that
 * drifted — the learning-graph one omitted isEnabled, commands' used a wider
 * status union). Optional members stay optional: capabilities that need the
 * fail-closed distinction read `isEnabled`, others may ignore it. */
export type ApprovalLike = {
  request(input: ApprovalRequest): Promise<ApprovalDecision>
  run(kind: PendingKind, args: unknown, intent?: { interface: 'background_review' }): Promise<{ ok: boolean; message: string }>
  hasRunner(kind: PendingKind): boolean
  isEnabled?: boolean
  registerRunner(kind: PendingKind, runner: WriteRunner): () => void
  list(status?: PendingStatus): Promise<PendingRecord[]>
  approve(id: string): Promise<{ ok: boolean; message: string }>
  reject(id: string): Promise<{ ok: boolean; message: string }>
}

/** 0.3.23 (G4.8): the ONE shape of the platform approval-policy probe that
 * `effectiveSessionPolicy` reads. The model tools used to copy this view
 * locally (F-341). */
export interface ApprovalPolicyLike {
  overrideOf(session: unknown): 'ask' | 'never' | undefined
  config: { policy?: 'ask' | 'never' }
}

/** The requesting session's effective policy (override ?? configured default);
 * undefined when the approval service is not mounted or no session is
 * available — callers keep their previous behavior. Single source (G4.8,
 * F-341): the model tools each copied this helper; it lives here now. */
export function effectiveSessionPolicy(ctx: Context, session: unknown): 'ask' | 'never' | undefined {
  const approval = ctx.get('approval') as ApprovalPolicyLike | undefined
  if (!approval || session === undefined) return undefined
  return approval.overrideOf(session) ?? approval.config.policy ?? 'ask'
}

interface EvolutionStateLike {
  listPending(status?: PendingStatus): Promise<PendingRecord[]>
  savePending(record: PendingRecord): Promise<void>
  tryResolvePending(id: string, status: 'approved' | 'rejected'): Promise<{ record: PendingRecord | null; applied: boolean }>
  claimPending(id: string, claimId: string): Promise<PendingRecord | null>
  releasePendingClaim(id: string, claimId: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionApproval: EvolutionApproval
  }
}

export interface Config {
  /** Master switch. Default false matches Hermes write_approval default. */
  enabled?: boolean
  /** Require approval for foreground writes as well. */
  stageForeground?: boolean
}

export class EvolutionApproval extends Service {
  static inject = ['evolutionState']
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(false),
    stageForeground: z.boolean().default(true),
  })

  private readonly enabled: boolean
  private readonly stageForeground: boolean
  private readonly runners = new Map<PendingKind, WriteRunner>()
  private readonly inFlight = new Map<string, Promise<{ ok: boolean; message: string }>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionApproval')
    this.enabled = config.enabled ?? false
    this.stageForeground = config.stageForeground ?? true
  }

  private state(): EvolutionStateLike {
    return this.ctx.evolutionState
  }

  /** Fail-closed capability adapters need to distinguish "allowed" from "enabled". */
  get isEnabled(): boolean {
    return this.enabled
  }

  registerRunner(kind: PendingKind, runner: WriteRunner): () => void {
    // P3 (v3 audit): a duplicate kind would silently shadow the first runner
    // (mirroring EvolutionStateStorageRegistry.registerProvider, which throws).
    if (this.runners.has(kind)) throw new Error(`approval runner for "${kind}" is already registered`)
    this.runners.set(kind, runner)
    return () => {
      if (this.runners.get(kind) === runner) this.runners.delete(kind)
    }
  }

  /**
   * Whether a replay runner is registered for `kind` (rc.42 audit P1-9
   * pre-check surface): callers that can execute a write directly (the review
   * pipeline) use it to avoid staging a pending record that no runner could
   * ever replay. `capability` records are answerable without a runner by
   * design, so they are exempt from the staging pre-check.
   */
  hasRunner(kind: PendingKind): boolean {
    return this.runners.has(kind)
  }

  /**
   * Trusted plan-executor entry point: replay a write through the registered
   * runner exactly once. 0.3.17 (S3.2, E-23): this is the BACKGROUND-REVIEW
   * replay channel only — the caller must declare the intent (the review
   * pipeline is the sole production consumer); a bare call is refused so the
   * staging boundary cannot be bypassed by accident from another surface.
   */
  async run(kind: PendingKind, args: unknown, intent?: { interface: 'background_review' }): Promise<{ ok: boolean; message: string }> {
    if (intent?.interface !== 'background_review') {
      return { ok: false, message: 'approval.run is the background-review replay channel; direct execution must use the tool path (staging is the only gate bypass for foreground).' }
    }
    const runner = this.runners.get(kind)
    if (!runner) return { ok: false, message: `No replay runner registered for kind "${kind}".` }
    return await runner(args)
  }

  /** Evaluate one mutation. Returns allow, or stores the write and returns staged. */
  async request(input: ApprovalRequest): Promise<ApprovalDecision> {
    const summary = normalizeSummary(input)
    if (!this.enabled) return { action: 'allow', message: 'Approval disabled.' }
    // 0.3.17 (S3.1, E-22): the session policy is DERIVED server-side from the
    // platform approval service when it is mounted (overrideOf is the platform
    // authority). The caller's self-reported sessionPolicy is honored ONLY in
    // assemblies WITHOUT the platform service — a tool can no longer claim
    // 'never' and bypass staging on its own.
    const derived = this.deriveSessionPolicy(input.sessionId)
    const policy = derived ?? (this.ctx.get('approval') ? undefined : input.sessionPolicy)
    if (policy === 'never') {
      return { action: 'allow', message: 'Session approval policy is "never"; write allowed without staging.' }
    }
    if (input.origin === 'background_review' || this.stageForeground) {
      // Observability for the P1-9 trap (rc.42 audit): staging a memory/skill
      // write with no registered runner creates a pending record that no
      // approver could ever replay. Callers with a direct executor pre-check
      // `hasRunner`; this warn keeps any other caller's mistake visible.
      if (input.kind !== 'capability' && !this.runners.has(input.kind)) {
        this.ctx.logger.warn(`evolution-approval: staging "${input.kind}" write with no replay runner registered - it will not be approvable`)
      }
      const record: PendingRecord = {
        id: randomUUID(),
        kind: input.kind,
        summary,
        args: input.args,
        createdAt: new Date().toISOString(),
        status: 'pending',
        // 0.3.17 (E-25): attribution was previously dropped at staging — the
        // audit history could not say WHERE a staged write came from.
        origin: input.origin,
        ...input.sessionId ? { sessionId: input.sessionId } : {},
      }
      await this.state().savePending(record)
      return {
        action: 'staged',
        pendingId: record.id,
        message: `Write staged for approval. Review with /evolution pending and approve ${record.id}.`,
      }
    }
    return { action: 'allow', message: 'Foreground write allowed.' }
  }

  async list(status: PendingStatus = 'pending'): Promise<PendingRecord[]> {
    return await this.state().listPending(status)
  }

  async approve(id: string): Promise<{ ok: boolean; message: string }> {
    return await this.dedupe(`approve:${id}`, () => this.doApprove(id))
  }

  async reject(id: string): Promise<{ ok: boolean; message: string }> {
    return await this.dedupe(`reject:${id}`, async () => {
      // Reject claims the record like approve does, so it can never race an
      // in-flight approve runner: the claim table is the single resolution gate.
      const claimId = randomUUID()
      const record = await this.state().claimPending(id, claimId)
      if (!record) {
        // 0.3.17 (S3.3): operator cleanup for a crashed approve — rejecting an
        // 'executing' record resolves it WITHOUT running any runner (the write
        // may already have landed; approval never replays it).
        const stuck = (await this.state().listPending('executing')).find(item => item.id === id)
        if (stuck) {
          const resolution = await this.state().tryResolvePending(id, 'rejected')
          return resolution.applied
            ? { ok: true, message: `Rejected executing write "${id}" (crashed approve cleaned up; verify the write state manually).` }
            : { ok: false, message: `Pending write "${id}" could not be rejected: it resolved concurrently.` }
        }
        return { ok: false, message: `Pending write "${id}" is already being resolved by another writer.` }
      }
      const resolution = await this.state().tryResolvePending(id, 'rejected')
      if (!resolution.applied || !resolution.record) {
        // 0.3.17 (E-61): the claim stays HELD otherwise — the reject path was
        // asymmetric with approve (which releases on every failure branch).
        await this.state().releasePendingClaim(id, claimId)
        return { ok: false, message: `Pending write "${id}" is not pending (already resolved or missing).` }
      }
      return { ok: true, message: `Rejected ${resolution.record.kind} write "${id}".` }
    })
  }

  /**
   * 0.3.17 (S3.1): platform-side session policy derivation — the platform's
   * approval service (`overrideOf`) is the authority; a caller's self-reported
   * sessionPolicy is a fallback only without it (E-22). The mount check is
   * lazy: the platform service can start before or after this plugin.
   */
  private deriveSessionPolicy(sessionId?: string): 'ask' | 'never' | undefined {
    if (!sessionId) return undefined
    const platformApproval = this.ctx.get('approval') as { overrideOf?(sessionId: string): unknown } | undefined
    if (!platformApproval) return undefined
    const override = platformApproval.overrideOf?.(sessionId)
    return override === 'never' || override === 'ask' ? override : undefined
  }

  private dedupe(id: string, task: () => Promise<{ ok: boolean; message: string }>): Promise<{ ok: boolean; message: string }> {
    const existing = this.inFlight.get(id)
    if (existing) return existing
    const run = task().finally(() => { this.inFlight.delete(id) })
    this.inFlight.set(id, run)
    return run
  }

  private async doApprove(id: string): Promise<{ ok: boolean; message: string }> {
    const claimId = randomUUID()
    const record = await this.state().claimPending(id, claimId)
    if (!record) {
      // 0.3.17 (S3.3, E-24): the claim was refused — either another writer is
      // resolving, or the record sits 'executing' (a previous approve may have
      // run then crashed). NEVER auto-replay an executing record: the write
      // may already have landed, and re-running it duplicates a non-idempotent
      // operation.
      const stuck = (await this.state().listPending('executing')).find(item => item.id === id)
      if (stuck) {
        return { ok: false, message: `Pending write "${id}" is executing (a previous approve may have run before a crash). Verify its effect manually, then reject it — /evolution pending shows it as EXECUTING.` }
      }
      return { ok: false, message: `Pending write "${id}" is already being resolved by another writer.` }
    }
    const runner = this.runners.get(record.kind)
    if (!runner) {
      if (record.kind === 'capability') {
        const resolution = await this.state().tryResolvePending(id, 'approved')
        if (!resolution.applied) return { ok: false, message: `Pending write "${id}" was already resolved.` }
        return { ok: true, message: 'Capability approved for manual activation in Creator mode (no code was executed).' }
      }
      await this.state().releasePendingClaim(id, claimId)
      return { ok: false, message: `No replay runner registered for kind "${record.kind}".` }
    }
    try {
      const result = await runner(record.args)
      if (!result.ok) {
        await this.state().releasePendingClaim(id, claimId)
        return { ok: false, message: result.message }
      }
    } catch (error) {
      await this.state().releasePendingClaim(id, claimId)
      this.ctx.logger.warn(error)
      return { ok: false, message: 'Replay runner failed; the pending write remains pending.' }
    }
    const resolution = await this.state().tryResolvePending(id, 'approved')
    if (!resolution.applied) {
      return { ok: false, message: `Pending write "${id}" was already resolved by another writer.` }
    }
    // 0.3.17 (E-61): the success message names what was approved, not just
    // the kind — a reviewer acting on several batches can tell them apart.
    return { ok: true, message: `Approved ${record.kind} write "${id}" (${record.summary}).` }
  }
}

export default EvolutionApproval

/** Compact, batch-aware approval summary so pending lists stay scannable. */
function normalizeSummary(input: { kind: PendingKind; summary: string; args: unknown }): string {
  const trimmed = input.summary.length > 120 ? `${input.summary.slice(0, 117)}...` : input.summary
  if (input.kind === 'memory') {
    const candidate = input.args as { operations?: unknown[]; target?: string } | undefined
    if (Array.isArray(candidate?.operations) && candidate.operations.length > 1) {
      return `memory ${candidate.target ?? 'memory'} batch of ${candidate.operations.length} operations`
    }
  }
  if (input.kind === 'skill' && /^skill delete /.test(trimmed)) return `${trimmed} (warning: archive)`
  return trimmed
}
