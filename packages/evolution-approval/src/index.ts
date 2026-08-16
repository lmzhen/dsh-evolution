/**
 * Stage/pending write approval for self-evolution mutations.
 *
 * DSH's native approval seam is one-shot only. This service adds the
 * Hermes-style staged queue: background review/curator writes are stored,
 * and a human approves or rejects them later. A runner registry replays the
 * exact mutation without passing through the gate a second time.
 *
 * @module @deepseek-ai/dsh-evolution-approval
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { PendingStore, type PendingKind, type PendingRecord } from './pending-store.ts'

export type { PendingKind, PendingRecord }

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
  static Config: Schema<Config> = z.object({
    enabled: z.boolean().default(false),
    stageForeground: z.boolean().default(true),
  })

  readonly store: PendingStore
  private readonly enabled: boolean
  private readonly stageForeground: boolean
  private readonly runners = new Map<PendingKind, WriteRunner>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionApproval')
    this.store = new PendingStore()
    this.enabled = config.enabled ?? false
    this.stageForeground = config.stageForeground ?? true
  }

  registerRunner(kind: PendingKind, runner: WriteRunner): () => void {
    this.runners.set(kind, runner)
    return () => {
      if (this.runners.get(kind) === runner) this.runners.delete(kind)
    }
  }

  /** Evaluate one mutation. Returns allow, or stores the write and returns staged. */
  async request(input: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.enabled) return { action: 'allow', message: 'Approval disabled.' }
    if (input.origin === 'background_review' || this.stageForeground) {
      const record = await this.store.stage(input.kind, input.summary, input.args)
      return {
        action: 'staged',
        pendingId: record.id,
        message: `Write staged for approval. Review with /evolution pending and approve ${record.id}.`,
      }
    }
    return { action: 'allow', message: 'Foreground write allowed.' }
  }

  list(status: 'pending' | 'approved' | 'rejected' = 'pending'): PendingRecord[] {
    return this.store.list(status)
  }

  async approve(id: string): Promise<{ ok: boolean; message: string }> {
    const record = this.list('pending').find(item => item.id === id)
    if (!record) return { ok: false, message: `Pending write "${id}" not found.` }
    const runner = this.runners.get(record.kind)
    if (!runner) return { ok: false, message: `No replay runner registered for kind "${record.kind}".` }
    const result = await runner(record.args)
    if (!result.ok) return { ok: false, message: result.message }
    await this.store.resolve(id, 'approved')
    return { ok: true, message: `Approved ${record.kind}: ${result.message}` }
  }

  async reject(id: string): Promise<{ ok: boolean; message: string }> {
    const resolved = await this.store.resolve(id, 'rejected')
    if (!resolved) return { ok: false, message: `Pending write "${id}" not found.` }
    return { ok: true, message: `Rejected ${resolved.kind} write "${id}".` }
  }
}

export default EvolutionApproval
