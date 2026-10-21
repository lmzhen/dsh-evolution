/**
 * resume command: verify rows re-enter round1; fuse rows re-enter round2 with the persisted
 * decision. pending/skipped rows are not resumable.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { loadMergeState } from './state.ts'
import { runScanCommand } from './scan-command.ts'
import { withMergeRun, type MergeRegistryPort, type WithMergeRunResult } from './run-shell.ts'
import type { ScanPorts, ScanRound2Outcome } from './scan-run.ts'
import type { MergeDecision, MergeRow } from './contracts.ts'
import { recordRound2Outcome } from './round2-outcome.ts'

export interface RunResumeCommandOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly registry: MergeRegistryPort
  readonly ports: ScanPorts
  /** Per-run ports for the verify branch (staging needs the new runId). */
  readonly makePorts?: (runId: string) => ScanPorts
  /** Optional new-child authoring port (approve-after-pending path). */
  readonly round2WithRun?: (row: MergeRow, decision: MergeDecision, signal: AbortSignal, runId: string) => Promise<ScanRound2Outcome>
  readonly rowId: string
  readonly platformWrite: boolean
  readonly timeoutMinutes?: number
  readonly now: () => number
}

export async function runResumeCommand(options: RunResumeCommandOptions): Promise<WithMergeRunResult> {
  const loaded = await loadMergeState(options.io, options.home)
  const row = loaded.state.rows.find(item => item.id === options.rowId)
  if (row === undefined) return { ok: false, message: 'merge row not found: ' + options.rowId }
  if (row.state === 'verify') {
    return await runScanCommand({
      io: options.io, home: options.home, registry: options.registry,
      approval: true, platformWrite: options.platformWrite, now: options.now,
      ...(options.makePorts === undefined
        ? { ports: { ...options.ports, screening: () => Promise.resolve([{ a: row.a, b: row.b }]) } }
        : {
          makePorts: (runId) => {
            const makePorts = options.makePorts
            if (makePorts === undefined) throw new Error('resume makePorts disappeared')
            return { ...makePorts(runId), screening: () => Promise.resolve([{ a: row.a, b: row.b }]) }
          },
        }),
      ...(options.timeoutMinutes === undefined ? {} : { timeoutMinutes: options.timeoutMinutes }),
    })
  }
  if (row.state !== 'fuse') return { ok: false, message: 'row is not resumable from state ' + row.state }
  const decision = row.decision
  if (decision === undefined) return { ok: false, message: 'fuse row has no decision' }
  return await withMergeRun({
    io: options.io, home: options.home, registry: options.registry,
    command: 'resume', approval: { platformWrite: options.platformWrite, mergeApproval: true }, now: options.now,
    async body(ctx) {
      await ctx.stage('author', { done: 0, total: 1 })
      let outcome
      try {
        outcome = options.round2WithRun === undefined
          ? await options.ports.round2(row, decision, ctx.signal)
          : await options.round2WithRun(row, decision, ctx.signal, ctx.runId)
      } catch (error) {
        outcome = { kind: 'failed' as const, failure: { stage: 'author' as const, code: 'merge-failed', message: error instanceof Error ? error.message : String(error), retryable: true, retryFrom: 'agent2' as const } }
      }
      const record = await recordRound2Outcome(options.io, options.home, options.now, row, outcome)
      return {
        stopReason: record.merged ? 'completed' as const : 'failed' as const,
        scope: { candidatePairs: 1, queueBefore: { pending: 0, retry: 1, skipped: 0 } },
        pairs: [record.pair],
        totals: record.merged ? { merged: 1, kept: 0, pending: 0, failed: 0 } : { merged: 0, kept: 0, pending: 0, failed: 1 },
        notes: [],
      }
    },
  })
}
