/**
 * resume command: verify rows re-enter round1; fuse rows re-enter round2 with the persisted
 * decision. pending/skipped rows are not resumable.
 */
import { errorText, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { loadMergeState } from './state.ts'
import { runScanCommand } from './scan-command.ts'
import { withMergeRun, type MergeRegistryPort, type WithMergeRunResult } from './run-shell.ts'
import type { ScanPorts, ScanRound2Outcome } from './scan-run.ts'
import type { MergeDecision, MergeRow } from './contracts.ts'
import { recordRound2Outcome } from './round2-outcome.ts'
import { pairLedger } from './domain/pair-ledger.ts'
import { presentStage } from './domain/stage-aggregate.ts'
import { v4ToLegacy } from './domain/row-v4.ts'
import { failure } from './domain/errors.ts'

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
  readonly approval: boolean
  readonly parentRunId?: string
  readonly detached?: boolean
  readonly pairTimeoutMinutes?: number
  readonly timeoutMinutes?: number
  readonly now: () => number
  readonly isOwnerActive?: (runId: string) => boolean | Promise<boolean>
  /** The invocation carried no agent at all (E-305), as opposed to an agent with no parent run. */
  readonly agentless?: boolean
}

export async function runResumeCommand(options: RunResumeCommandOptions): Promise<WithMergeRunResult> {
  const loaded = await loadMergeState(options.io, options.home)
  let row = loaded.state.rows.find(item => item.id === options.rowId)
  if (row === undefined) return failure('resume', 'row-not-found', '找不到可恢复行 ' + options.rowId, '运行 /evolution merge candidates 查看可恢复行')
  const selected = row
  if (selected.state === 'verify') {
    if (row.runId !== undefined && (await options.isOwnerActive?.(row.runId)) === true) {
      return failure('resume', 'run-owns-row', '该 verify 行仍由运行中的 run 持有：' + row.runId, '等待该 run 结束，或运行 /evolution merge cancel ' + row.runId, row.runId)
    }
    return await runScanCommand({
      io: options.io, home: options.home, registry: options.registry,
      approval: options.approval, platformWrite: options.platformWrite, now: options.now,
      ...(options.detached === true ? { detached: true } : {}),
      ...(options.makePorts === undefined
        ? { ports: { ...options.ports, screening: () => Promise.resolve([{ a: selected.a, b: selected.b }]) } }
        : {
          makePorts: (runId) => {
            const makePorts = options.makePorts
            if (makePorts === undefined) throw new Error('resume makePorts disappeared')
            return { ...makePorts(runId), screening: () => Promise.resolve([{ a: selected.a, b: selected.b }]) }
          },
        }),
      ...(options.timeoutMinutes === undefined ? {} : { timeoutMinutes: options.timeoutMinutes }),
      ...(options.isOwnerActive === undefined ? {} : { isOwnerActive: options.isOwnerActive }),
    })
  }
  if (row.state !== 'fuse' && row.state !== 'approved') return failure('resume', 'row-not-resumable', '该行状态是 ' + row.state + '，不可恢复', '只有 approved/fuse 行可恢复；运行 /evolution merge status 查看队列', row.runId)
  if (row.runId !== undefined && (await options.isOwnerActive?.(row.runId)) === true) {
    return failure('resume', 'run-owns-row', '该 fuse 行仍由运行中的 run 持有：' + row.runId, '等待该 run 结束，或运行 /evolution merge cancel ' + row.runId, row.runId)
  }
  if (options.agentless === true) return failure('resume', 'e-305', errorText('e-305-this-invocation-carries-no', { a1: 'resume' }), '在 GUI 或 CLI 的会话里运行 /evolution merge resume --retry ' + row.id)
  const parentRunId = options.parentRunId ?? row.runId
  if (parentRunId === undefined) return failure('resume', 'merge-parent-required', '缺 parent run id（E-305 提示：该行可能由无会话调用创建，或父 run 已丢失）', '在 agent 会话中执行 /evolution merge resume --retry ' + row.id, row.runId)
  const decision = selected.decision
  if (decision === undefined) return failure('resume', 'row-invalid', '该 fuse 行没有持久化决策', '重新 pair 该技能对后再次恢复', row.runId)
  if (selected.state === 'approved' && options.ports.stage !== undefined) {
    const staged = await options.ports.stage(selected, decision)
    if (!staged.ok) return failure('resume', 'stage-failed', staged.message, '检查暂存目录后重试；不影响已记录的决策', selected.runId)
    const fused = await pairLedger(options.io, options.home).transact(tx => {
      const current = tx.rows().find(item => item.id === selected.id)
      if (current === undefined) return null
      const moved = tx.transition(selected.id, { type: 'staged', stagingRef: staged.entry.ref, stagingExpiresAt: staged.entry.expiresAt }, current.version)
      return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
    })
    if (fused === null) return failure('resume', 'row-changed', '行在暂存完成前被并发修改：' + selected.id, '运行 /evolution merge status ' + selected.id + ' 后重试', selected.runId)
    await presentStage(options.io, options.home, staged.entry)
    row = fused
  }
  const result = await withMergeRun({
    io: options.io, home: options.home, registry: options.registry,
    command: 'resume', approval: { platformWrite: options.platformWrite, mergeApproval: options.approval }, pairKey: row.pairKey,
    ...(row.stagingRef === undefined ? {} : { stagingRef: row.stagingRef }),
    parentRunId, now: options.now,
    ...(options.detached === true ? { detached: true } : {}),
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
      const record = await recordRound2Outcome(options.io, options.home, options.now, row, outcome, true)
      return {
        stopReason: record.merged ? 'completed' as const : 'failed' as const,
        scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 1, skipped: 0 } },
        pairs: [record.pair],
        totals: record.merged ? { merged: 1, kept: 0, pending: 0, failed: 0 } : { merged: 0, kept: 0, pending: 0, failed: 1 },
        notes: [],
        ...(record.finalize === undefined ? {} : { finalize: record.finalize }),
      }
    },
  })
  return result
}
