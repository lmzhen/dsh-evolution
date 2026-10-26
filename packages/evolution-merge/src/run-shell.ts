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
import type { MergeError } from './domain/errors.ts'
import { writeRunMeta } from './domain/run-coordinator.ts'

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
  readonly reportOnly?: MergeReport['reportOnly']
  readonly validationFailures?: MergeReport['validationFailures']
  readonly archived?: MergeReport['archived']
  readonly commit?: MergeReport['commit']
  readonly usage?: MergeReport['usage']
  readonly timing?: MergeReport['timing']
  readonly criteria?: MergeReport['criteria']
  /** Runs after the report is durable and before core settle (row/stage projection). */
  readonly finalize?: () => Promise<void>
}

export interface WithMergeRunOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly registry: MergeRegistryPort
  readonly command: MergeRunCommand
  readonly approval: MergeReport['approval']
  readonly now: () => number
  readonly total?: number
  readonly pairKey?: string
  readonly pairCount?: number
  readonly stagingRef?: string
  readonly parentRunId?: string
  readonly detached?: boolean
  readonly timeoutMinutes?: number
  readonly body: (ctx: MergeRunBodyContext) => Promise<MergeRunReportDraft>
}

export type WithMergeRunResult =
  | { readonly ok: true; readonly runId: string; readonly reportPath: string; readonly report: MergeReport }
  | { readonly ok: true; readonly accepted: true; readonly runId: string }
  | { readonly ok: false; readonly runId?: string; readonly message: string; readonly reportPath?: string; readonly error?: MergeError }

function emptyDraft(reason: string): MergeRunReportDraft {
  return {
    stopReason: 'failed',
    scope: { candidatePairs: 0, queueBefore: { verify: 0, pending: 0, fuse: 0, skipped: 0 } },
    pairs: [],
    totals: { merged: 0, kept: 0, pending: 0, failed: 0 },
    notes: [reason],
  }
}

export async function retryMergeReport(io: EvolutionIoLike, home: string, report: MergeReport): Promise<string> {
  return await writeMergeReport(io, home, report)
}

export async function withMergeRun(options: WithMergeRunOptions): Promise<WithMergeRunResult> {
  const handle = await options.registry.begin('merge', {
    command: options.command,
    ...(options.total === undefined ? {} : { total: options.total }),
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
  })
  const startedAt = handle.startedAt
  const stage = (name: RunStage, progress?: { done: number; total: number }) => options.registry.stage(handle.id, name, progress)
  await stage('screening', options.total === undefined ? undefined : { done: 0, total: options.total })
  await writeRunMeta(options.io, options.home, {
    version: 1, runId: handle.id, pid: process.pid,
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
    ...(options.pairKey === undefined ? {} : { pairKey: options.pairKey }),
    ...(options.stagingRef === undefined ? {} : { stagingRef: options.stagingRef }),
    ...(options.pairKey === undefined ? {} : { pairs: [{ pairKey: options.pairKey, state: 'pending' as const }] }),
    pairCount: options.pairCount ?? (options.pairKey === undefined ? 0 : 1),
    phase: 'running', approval: options.approval.mergeApproval ? 'pending' : 'approved',
    createdAt: new Date(startedAt).toISOString(), updatedAt: new Date(options.now()).toISOString(),
  })
  const finish = async (): Promise<WithMergeRunResult> => {
    let draft: MergeRunReportDraft
    const runController = new AbortController()
    const onAbort = (): void => { runController.abort() }
    handle.signal.addEventListener('abort', onAbort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutMinutes = options.timeoutMinutes
    const bodyOutcome = options.body({ runId: handle.id, startedAt, signal: runController.signal, stage })
      .then(value => ({ kind: 'draft' as const, value }))
      .catch(error => ({ kind: 'error' as const, error }))
    let outcome: { kind: 'draft'; value: MergeRunReportDraft } | { kind: 'error'; error: unknown }
    let timedOut = false
    try {
      if (timeoutMinutes === undefined || timeoutMinutes <= 0) {
        outcome = await bodyOutcome
      } else {
        const timeout = new Promise<{ kind: 'timeout' }>(resolve => {
          timer = setTimeout(() => {
            // Abort first, then wait for the body, but never without a second bound: a body
            // that ignores the signal must not leave the run open forever.
            runController.abort()
            resolve({ kind: 'timeout' })
          }, timeoutMinutes * 60_000)
        })
        const raced = await Promise.race([bodyOutcome, timeout])
        if (raced.kind !== 'timeout') outcome = raced
        else {
          timedOut = true
          let drainTimer: ReturnType<typeof setTimeout> | undefined
          const drained = await Promise.race([
            bodyOutcome,
            new Promise<{ kind: 'drain-timeout' }>(resolve => { drainTimer = setTimeout(() => resolve({ kind: 'drain-timeout' }), 30_000) }),
          ])
          if (drainTimer !== undefined) clearTimeout(drainTimer)
          outcome = drained.kind === 'drain-timeout'
            ? { kind: 'error', error: new Error('timeout: body did not stop within 30s drain window') }
            : drained
        }
      }
      draft = outcome.kind === 'draft'
        ? outcome.value
        : emptyDraft('run body failed: ' + (outcome.error instanceof Error ? outcome.error.message : String(outcome.error)))
      if (timedOut) draft = { ...draft, stopReason: 'timeout', notes: [...draft.notes, 'merge run timeout reached; body aborted'] }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      handle.signal.removeEventListener('abort', onAbort)
    }
    const report: MergeReport = {
      schemaVersion: 2,
      runId: handle.id,
      kind: 'merge',
      command: options.command,
      startedAt,
      endedAt: options.now(),
      stopReason: draft.stopReason,
      approval: options.approval,
      scope: draft.scope,
      pairs: draft.pairs,
      processedPairs: draft.pairs,
      totals: draft.totals,
      notes: draft.notes,
      ...(draft.remaining === undefined ? {} : { remaining: draft.remaining, remainingPairs: draft.remaining }),
      ...(draft.reportOnly === undefined ? {} : { reportOnly: draft.reportOnly }),
      ...(draft.validationFailures === undefined ? {} : { validationFailures: draft.validationFailures }),
      ...(draft.archived === undefined ? {} : { archived: draft.archived }),
      ...(draft.commit === undefined ? {} : { commit: draft.commit }),
      ...(draft.usage === undefined ? {} : { usage: draft.usage }),
      ...(draft.timing === undefined ? {} : { timing: draft.timing }),
      ...(draft.criteria === undefined ? {} : { criteria: draft.criteria }),
    }
    let reportPath: string
    try {
      reportPath = await writeMergeReport(options.io, options.home, report)
    } catch (error) {
      await options.registry.settle(handle.id, { state: 'failed', failure: 'report write failed: ' + (error instanceof Error ? error.message : String(error)) })
      return { ok: false, runId: handle.id, message: 'report write failed' }
    }
    try {
      await draft.finalize?.()
    } catch (error) {
      await options.registry.settle(handle.id, { state: 'failed', resultRef: reportPath, failure: 'post-report finalize failed: ' + (error instanceof Error ? error.message : String(error)) })
      return { ok: false, runId: handle.id, message: 'post-report finalize failed', reportPath }
    }
    const runState = report.stopReason === 'completed'
      ? 'succeeded'
      : report.stopReason === 'cancelled'
        ? 'cancelled'
        : 'failed'
    await options.registry.settle(handle.id, { state: runState, resultRef: reportPath, ...(runState === 'failed' ? { failure: 'merge ' + report.stopReason } : {}) })
    // FR-RUN-04: awaiting-approval is a fact about THIS run, not about the approval mode.
    // Only a completed scan/pair that actually left pending rows is waiting for a human;
    // a failed/cancelled run (or one that produced nothing to approve) settled long ago,
    // and approve/resume are themselves the answer to a pending window.
    const awaiting = options.approval.mergeApproval
      && (options.command === 'scan' || options.command === 'pair')
      && report.stopReason === 'completed'
      && report.totals.pending > 0
    const finalPairs = draft.pairs.length > 0
      ? draft.pairs.map(pair => ({ pairKey: pair.pairKey, state: pair.outcome === 'merged' ? 'fused' as const : pair.outcome === 'pending' ? 'pending' as const : 'skipped' as const }))
      : options.pairKey === undefined ? [] : [{ pairKey: options.pairKey, state: 'pending' as const }]
    await writeRunMeta(options.io, options.home, { version: 1, runId: handle.id, pid: process.pid, ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }), ...(options.pairKey === undefined ? {} : { pairKey: options.pairKey }), ...(options.stagingRef === undefined ? {} : { stagingRef: options.stagingRef }), ...(finalPairs.length === 0 ? {} : { pairs: finalPairs }), pairCount: options.pairCount ?? (options.pairKey === undefined ? 0 : 1), phase: awaiting ? 'awaiting-approval' : 'settled', approval: awaiting ? 'pending' : 'approved', stopReason: report.stopReason, reportRef: reportPath, createdAt: new Date(startedAt).toISOString(), updatedAt: new Date(options.now()).toISOString() })
    if (report.stopReason === 'completed') return { ok: true, runId: handle.id, reportPath, report }
    return { ok: false, runId: handle.id, message: 'merge ' + report.stopReason, reportPath }
  }
  if (options.detached === true) {
    void finish().catch(() => {})
    return { ok: true, accepted: true, runId: handle.id }
  }
  return await finish()
}
