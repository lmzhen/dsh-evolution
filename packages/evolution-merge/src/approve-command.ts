/**
 * approve command: one pending row is atomically taken to fuse, then a new run executes
 * round2 with the persisted decision. A second approve loses at approvePending (not-pending).
 */
import type { EvolutionIoLike, RunStage } from '@deepseek-ai/dsh-evolution-core'
import { transition } from './coordinator.ts'
import type { MergeDecision, MergeRow } from './contracts.ts'
import { dropRow, upsertRow } from './state.ts'
import { approvePending } from './pending-actions.ts'
import type { MergeRegistryPort, WithMergeRunResult } from './run-shell.ts'
import { withMergeRun } from './run-shell.ts'
import type { ScanRound2Outcome } from './scan-run.ts'

export interface ApprovePorts {
  round2(row: MergeRow, decision: MergeDecision, signal: AbortSignal): Promise<ScanRound2Outcome>
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
        outcome = await options.ports.round2(row, decision, ctx.signal)
      } catch (error) {
        outcome = { kind: 'failed', failure: { stage: 'author', code: 'merge-failed', message: error instanceof Error ? error.message : String(error), retryable: true, retryFrom: 'agent2' } }
      }
      const base = { scope: { candidatePairs: 1, queueBefore: { pending: 0, retry: 1, skipped: 0 } }, notes: [] as string[] }
      if (outcome.kind === 'merged') {
        const success = transition(row, { type: 'round2-success', at: new Date(options.now()).toISOString() })
        if (success.ok) await dropRow(options.io, options.home, options.now, row.id)
        return {
          ...base,
          stopReason: 'completed' as const,
          pairs: [{
            id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue, decision,
            outcome: 'merged' as const, archived: outcome.archived ?? [],
            ...(outcome.unitId === undefined ? {} : { unitId: outcome.unitId }),
            ...(outcome.target === undefined ? {} : { target: outcome.target }),
          }],
          totals: { merged: 1, kept: 0, pending: 0, failed: 0 },
        }
      }
      const failure = outcome.failure ?? { stage: 'author' as const, code: 'merge-failed', message: 'round2 failed', retryable: true, retryFrom: 'agent2' as const }
      const next = transition(row, { type: 'round2-fail', failure, at: new Date(options.now()).toISOString() })
      if (next.ok && next.row !== null) await upsertRow(options.io, options.home, options.now, next.row)
      return {
        ...base,
        stopReason: 'failed' as const,
        pairs: [{ id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue, decision, outcome: 'failed' as const, archived: [], failure }],
        totals: { merged: 0, kept: 0, pending: 0, failed: 1 },
      }
    },
  })
}
