/**
 * Merge run shell: registry lifecycle + report-before-settle.
 *
 * The pair executor is injected. This module owns the invariants every command shares:
 * begin a merge run, publish stage/progress, write the report, then settle with resultRef.
 * A body failure still produces a failed report (unless the report itself cannot be written).
 */
import type {
  EvolutionIoLike,
  RunHandle,
  RunKind,
  RunStage,
} from '@deepseek-ai/dsh-evolution-core'
import type { MergeReport, MergeReportPair, MergeRunCommand } from './contracts.ts'
import { writeMergeReport } from './report.ts'

export interface MergeRegistryPort {
  begin(kind: RunKind, seed?: { command?: MergeRunCommand; total?: number; parentRunId?: string }): Promise<Pick<RunHandle, 'id' | 'signal' | 'startedAt'>>
  stage(id: string, stage: RunStage, progress?: { done: number; total: number }): Promise<void>
  settle(id: string, outcome: { state: 'succeeded' | 'failed' | 'cancelled'; resultRef?: string; failure?: string }): Promise<void>
}

export interface MergeRunBodyContext {
  readonly runId: string
  readonly startedAt: number
  readonly signal: AbortSignal
  readonly stage: (stage: RunStage, progress?: { done: number; total: number }) => Promise<void>
}

export interface MergeRunReportDraft {
  readonly stopReason: MergeReport['stopReason']
  readonly scope: MergeReport['scope']
  readonly pairs: readonly MergeReportPair[]
  readonly totals: MergeReport['totals']
  readonly notes: readonly string[]
  readonly remaining?: MergeReport['remaining']
}

export interface WithMergeRunOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly registry: MergeRegistryPort
  readonly command: MergeRunCommand
  readonly approval: MergeReport['approval']
  readonly now: () => number
  readonly total?: number
  readonly body: (ctx: MergeRunBodyContext) => Promise<MergeRunReportDraft>
}

export type WithMergeRunResult =
  | { readonly ok: true; readonly runId: string; readonly reportPath: string; readonly report: MergeReport }
  | { readonly ok: false; readonly runId?: string; readonly message: string; readonly reportPath?: string }

function emptyDraft(reason: string): MergeRunReportDraft {
  return {
    stopReason: 'failed',
    scope: { candidatePairs: 0, queueBefore: { pending: 0, retry: 0, skipped: 0 } },
    pairs: [],
    totals: { merged: 0, kept: 0, pending: 0, failed: 0 },
    notes: [reason],
  }
}

export async function withMergeRun(options: WithMergeRunOptions): Promise<WithMergeRunResult> {
  const handle = await options.registry.begin('merge', {
    command: options.command,
    ...(options.total === undefined ? {} : { total: options.total }),
  })
  const startedAt = handle.startedAt
  const stage = (name: RunStage, progress?: { done: number; total: number }) => options.registry.stage(handle.id, name, progress)
  await stage('screening', options.total === undefined ? undefined : { done: 0, total: options.total })
  let draft: MergeRunReportDraft
  try {
    draft = await options.body({ runId: handle.id, startedAt, signal: handle.signal, stage })
  } catch (error) {
    draft = emptyDraft('run body failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  const report: MergeReport = {
    schemaVersion: 1,
    runId: handle.id,
    kind: 'merge',
    command: options.command,
    startedAt,
    endedAt: options.now(),
    stopReason: draft.stopReason,
    approval: options.approval,
    scope: draft.scope,
    pairs: draft.pairs,
    totals: draft.totals,
    notes: draft.notes,
    ...(draft.remaining === undefined ? {} : { remaining: draft.remaining }),
  }
  let reportPath: string
  try {
    reportPath = await writeMergeReport(options.io, options.home, report)
  } catch (error) {
    await options.registry.settle(handle.id, { state: 'failed', failure: 'report write failed: ' + (error instanceof Error ? error.message : String(error)) })
    return { ok: false, runId: handle.id, message: 'report write failed' }
  }
  const runState = report.stopReason === 'completed'
    ? 'succeeded'
    : report.stopReason === 'cancelled'
      ? 'cancelled'
      : 'failed'
  await options.registry.settle(handle.id, { state: runState, resultRef: reportPath, ...(runState === 'failed' ? { failure: 'merge ' + report.stopReason } : {}) })
  if (report.stopReason === 'completed') return { ok: true, runId: handle.id, reportPath, report }
  return { ok: false, runId: handle.id, message: 'merge ' + report.stopReason, reportPath }
}
