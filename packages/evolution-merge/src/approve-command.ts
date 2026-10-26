/**
 * approve command: one pending row is atomically taken to fuse, then a new run executes
 * round2 with the persisted decision. A second approve loses at approvePending (not-pending).
 */
import { errorText, type EvolutionIoLike, type RunStage } from '@deepseek-ai/dsh-evolution-core'
import type { MergeDecision, MergeRow } from './contracts.ts'
import { approvePending } from './pending-actions.ts'
import { pairLedger } from './domain/pair-ledger.ts'
import { presentStage, type StageEntry } from './domain/stage-aggregate.ts'
import { v4ToLegacy } from './domain/row-v4.ts'
import { loadMergeState } from './state.ts'
import type { MergeRegistryPort, WithMergeRunResult } from './run-shell.ts'
import { withMergeRun } from './run-shell.ts'
import type { ScanRound2Outcome } from './scan-run.ts'
import { recordRound2Outcome } from './round2-outcome.ts'
import { failure } from './domain/errors.ts'

export interface ApprovePorts {
  stage?(row: MergeRow, decision: MergeDecision): Promise<{ readonly ok: true; readonly entry: StageEntry } | { readonly ok: false; readonly message: string }>
  round2(row: MergeRow, decision: MergeDecision, signal: AbortSignal, runId: string): Promise<ScanRound2Outcome>
}

export interface RunApproveCommandOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly registry: MergeRegistryPort
  readonly ports: ApprovePorts
  readonly rowId: string
  readonly platformWrite: boolean
  readonly parentRunId?: string
  readonly detached?: boolean
  readonly pairTimeoutMinutes?: number
  readonly now: () => number
  /** The invocation carried no agent at all (E-305), as opposed to an agent with no parent run. */
  readonly agentless?: boolean
}

export async function runApproveCommand(options: RunApproveCommandOptions): Promise<WithMergeRunResult> {
  const loaded = await loadMergeState(options.io, options.home)
  const before = loaded.state.rows.find(item => item.id === options.rowId)
  if (before === undefined) return failure('approve', 'row-not-found', '找不到待批准行 ' + options.rowId, '运行 /evolution merge pending 查看当前待批准行')
  if (before.state !== 'pending') return failure('approve', 'row-not-pending', '该行当前状态是 ' + before.state + '，不能批准', '运行 /evolution merge status ' + before.id + ' 查看行状态', before.runId)
  if (options.agentless === true) return failure('approve', 'e-305', errorText('e-305-this-invocation-carries-no', { a1: 'approve' }), '在 GUI 或 CLI 的会话里运行 /evolution merge approve ' + before.id)
  const parentRunId = options.parentRunId ?? before.runId
  if (parentRunId === undefined) return failure('approve', 'merge-parent-required', '缺 parent run id（E-305 提示：该行可能由无会话调用创建，或父 run 已丢失）', '在 agent 会话中执行 /evolution merge approve ' + before.id, before.runId)
  const taken = await approvePending(options.io, options.home, options.now, options.rowId)
  if (!taken.ok) return failure('approve', 'approve-' + taken.reason, taken.message, '重试；若行状态已变化，运行 /evolution merge status ' + options.rowId, before.runId)
  let row = taken.row
  const decision = row.decision
  if (decision === undefined) return failure('approve', 'row-invalid', '该待批准行没有持久化决策', '重新 pair 该技能对后再次批准', row.runId)
  if (options.ports.stage !== undefined) {
    const staged = await options.ports.stage(row, decision)
    if (!staged.ok) return failure('approve', 'stage-failed', staged.message, '检查暂存目录后重试；不影响已记录的决策', row.runId)
    const fused = await pairLedger(options.io, options.home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      if (current === undefined) return null
      const moved = tx.transition(row.id, { type: 'staged', stagingRef: staged.entry.ref, stagingExpiresAt: staged.entry.expiresAt }, current.version)
      return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
    })
    if (fused === null) return failure('approve', 'row-changed', '行在暂存完成前被并发修改：' + row.id, '运行 /evolution merge status ' + row.id + ' 后重试', row.runId)
    await presentStage(options.io, options.home, staged.entry)
    row = fused
  }
  return await withMergeRun({
    io: options.io,
    home: options.home,
    registry: options.registry,
    command: 'approve',
    approval: { platformWrite: options.platformWrite, mergeApproval: true },
    pairKey: row.pairKey,
    ...(row.stagingRef === undefined ? {} : { stagingRef: row.stagingRef }),
    parentRunId,
    now: options.now,
    ...(options.detached === true ? { detached: true } : {}),
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
      const record = await recordRound2Outcome(options.io, options.home, options.now, row, outcome, true)
      return {
        ...base,
        stopReason: record.merged ? 'completed' as const : 'failed' as const,
        pairs: [record.pair],
        totals: record.merged
          ? { merged: 1, kept: 0, pending: 0, failed: 0 }
          : { merged: 0, kept: 0, pending: 0, failed: 1 },
        ...(record.finalize === undefined ? {} : { finalize: record.finalize }),
      }
    },
  })
}
