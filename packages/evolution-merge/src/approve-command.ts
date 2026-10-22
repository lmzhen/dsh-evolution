/**
 * approve command: one pending row is atomically taken to fuse, then a new run executes
 * round2 with the persisted decision. A second approve loses at approvePending (not-pending).
 */
import type { EvolutionIoLike, RunStage } from '@deepseek-ai/dsh-evolution-core'
import type { MergeDecision, MergeRow } from './contracts.ts'
import { approvePending } from './pending-actions.ts'
import { loadMergeState } from './state.ts'
import { acquireTargetClaim } from './target-claim.ts'
import type { MergeRegistryPort, WithMergeRunResult } from './run-shell.ts'
import { withMergeRun } from './run-shell.ts'
import type { ScanRound2Outcome } from './scan-run.ts'
import { recordRound2Outcome } from './round2-outcome.ts'

export interface ApprovePorts {
  round2(row: MergeRow, decision: MergeDecision, signal: AbortSignal, runId: string): Promise<ScanRound2Outcome>
}

export interface RunApproveCommandOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly registry: MergeRegistryPort
  readonly ports: ApprovePorts
  readonly rowId: string
  readonly platformWrite: boolean
  readonly now: () => number
}

export async function runApproveCommand(options: RunApproveCommandOptions): Promise<WithMergeRunResult> {
  const loaded = await loadMergeState(options.io, options.home)
  const before = loaded.state.rows.find(item => item.id === options.rowId)
  const target = before?.decision?.target
  const claim = target === undefined ? null : await acquireTargetClaim(options.io, options.home, target, options.now())
  if (target !== undefined && claim === null) return { ok: false, message: 'target already claimed by another approve: ' + target }
  try {
    const taken = await approvePending(options.io, options.home, options.now, options.rowId)
    if (!taken.ok) return { ok: false, message: taken.message }
    const row = taken.row
    const decision = row.decision
    if (decision === undefined) return { ok: false, message: 'pending row has no decision' }
    return await withMergeRun({
      io: options.io,
      home: options.home,
      registry: options.registry,
      command: 'approve',
      approval: { platformWrite: options.platformWrite, mergeApproval: true },
      now: options.now,
      async body(ctx) {
        const stage = (name: RunStage) => ctx.stage(name, { done: 0, total: 1 })
        await stage('author')
        let outcome: ScanRound2Outcome
        try {
          outcome = await options.ports.round2(row, decision, ctx.signal, ctx.runId)
        } catch (error) {
          outcome = { kind: 'failed', failure: { stage: 'author', code: 'merge-failed', message: error instanceof Error ? error.message : String(error), retryable: true, retryFrom: 'agent2' } }
        }
        const base = { scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 1, skipped: 0 } }, notes: [] as string[] }
        const record = await recordRound2Outcome(options.io, options.home, options.now, row, outcome)
        return {
          ...base,
          stopReason: record.merged ? 'completed' as const : 'failed' as const,
          pairs: [record.pair],
          totals: record.merged
            ? { merged: 1, kept: 0, pending: 0, failed: 0 }
            : { merged: 0, kept: 0, pending: 0, failed: 1 },
        }
      },
    })
  } finally {
    await claim?.release()
  }
}
