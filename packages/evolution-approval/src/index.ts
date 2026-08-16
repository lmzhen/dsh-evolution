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
  deletePending(id: string): Promise<void>
  tryResolvePending(id: string, status: 'approved' | 'rejected'): Promise<{ record: PendingRecord | null; applied: boolean }>
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
    return this.ctx.evolutionState as EvolutionStateLike
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
    if (!this.enabled) return { action: 'allow', message: 'Approval disabled.' }
    if (input.origin === 'background_review' || this.stageForeground) {
      const record: PendingRecord = {
        id: randomUUID(),
        kind: input.kind,
        summary: input.summary,
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
    const record = (await this.list('pending')).find(item => item.id === id)
    if (!record) return { ok: false, message: `Pending write "${id}" not found.` }
    const runner = this.runners.get(record.kind)
    if (!runner) {
      if (record.kind === 'capability') {
        const resolution = await this.state().tryResolvePending(id, 'approved')
        if (!resolution.applied) return { ok: false, message: `Pending write "${id}" was already resolved.` }
        return { ok: true, message: 'Capability approved for manual activation in Creator mode (no code was executed).' }
      }
      return { ok: false, message: `No replay runner registered for kind "${record.kind}".` }
    }
    const result = await runner(record.args)
    if (!result.ok) return { ok: false, message: result.message }
    const resolution = await this.state().tryResolvePending(id, 'approved')
    if (!resolution.applied) {
      return { ok: false, message: `Pending write "${id}" was already resolved by another writer.` }
    }
    return { ok: true, message: `Approved ${record.kind}: ${result.message}` }
  }
}

export default EvolutionApproval
