/**
 * Stage/pending write approval for self-evolution mutations.
 *
 * DSH's native approval seam is one-shot only. This service adds the
 * Hermes-style staged queue: background review/curator writes are stored in
 * `ctx.evolutionState`, and a human approves or rejects them later. A runner
 * registry replays the exact mutation without passing through the gate a
 * second time. Resolved records are KEPT as audit history.
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
}

export interface ApprovalDecision {
  action: 'allow' | 'staged'
  pendingId?: string
  message: string
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
    this.runners.set(kind, runner)
    return () => {
      if (this.runners.get(kind) === runner) this.runners.delete(kind)
    }
  }

  /** Trusted plan-executor entry point: replay a write through the registered runner exactly once. */
  async run(kind: PendingKind, args: unknown): Promise<{ ok: boolean; message: string }> {
    const runner = this.runners.get(kind)
    if (!runner) return { ok: false, message: `No replay runner registered for kind "${kind}".` }
    return await runner(args)
  }

  /** Evaluate one mutation. Returns allow, or stores the write and returns staged. */
  async request(input: ApprovalRequest): Promise<ApprovalDecision> {
    const summary = normalizeSummary(input)
    if (!this.enabled) return { action: 'allow', message: 'Approval disabled.' }
    if (input.origin === 'background_review' || this.stageForeground) {
      const record: PendingRecord = {
        id: randomUUID(),
        kind: input.kind,
        summary,
        args: input.args,
        createdAt: new Date().toISOString(),
        status: 'pending',
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
    return await this.dedupe(id, () => this.doApprove(id))
  }

  async reject(id: string): Promise<{ ok: boolean; message: string }> {
    return await this.dedupe(id, async () => {
      const resolution = await this.state().tryResolvePending(id, 'rejected')
      if (!resolution.applied || !resolution.record) {
        return { ok: false, message: `Pending write "${id}" is not pending (already resolved or missing).` }
      }
      return { ok: true, message: `Rejected ${resolution.record.kind} write "${id}".` }
    })
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
    if (!record) return { ok: false, message: `Pending write "${id}" is already being resolved by another writer.` }
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
    return { ok: true, message: `Approved ${record.kind}` }
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
