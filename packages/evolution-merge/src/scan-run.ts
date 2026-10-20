/**
 * The scan pair loop. Registry/report lifecycle stays in withMergeRun; this module owns
 * candidate → round1 → pending/fuse → commit transitions and returns the report draft.
 */
import {
  pairKey,
  queueOf,
  type MergeCandidate,
  type MergeDecision,
  type MergeFailure,
  type MergeReportPair,
  type MergeRow,
} from './contracts.ts'
import { transition } from './coordinator.ts'
import { dropRow, loadMergeState, upsertRow } from './state.ts'
import type { EvolutionIoLike, RunStage } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRunReportDraft } from './run-shell.ts'

export interface ScanRound1Outcome {
  readonly kind: 'keep' | 'merge' | 'failed'
  readonly decision?: MergeDecision
  readonly failure?: MergeFailure
}

export interface ScanRound2Outcome {
  readonly kind: 'merged' | 'failed'
  readonly unitId?: string
  readonly archived?: readonly string[]
  readonly target?: { readonly requested: string; readonly actual: string; readonly created: boolean }
  readonly failure?: MergeFailure
}

export interface ScanPorts {
  screening(signal: AbortSignal): Promise<readonly MergeCandidate[]>
  round1(candidate: MergeCandidate, signal: AbortSignal): Promise<ScanRound1Outcome>
  round2(row: MergeRow, decision: MergeDecision, signal: AbortSignal): Promise<ScanRound2Outcome>
}

export interface RunScanOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly now: () => number
  readonly signal: AbortSignal
  readonly approval: boolean
  readonly ports: ScanPorts
  readonly stage?: (stage: RunStage, progress?: { done: number; total: number }) => Promise<void>
}

function at(now: () => number): string {
  return new Date(now()).toISOString()
}

function failureOf(stage: MergeFailure['stage'], error: unknown): MergeFailure {
  return {
    stage,
    code: 'merge-failed',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    retryFrom: stage === 'decide' ? 'agent1' : 'agent2',
  }
}

function pairOf(row: MergeRow, candidate: MergeCandidate, outcome: MergeReportPair['outcome'], extra: Partial<MergeReportPair> = {}): MergeReportPair {
  return {
    id: row.id,
    pairKey: row.pairKey,
    a: row.a,
    b: row.b,
    queue: row.queue,
    candidate,
    outcome,
    archived: [],
    ...extra,
  }
}

export async function runScan(options: RunScanOptions): Promise<MergeRunReportDraft> {
  const stage = options.stage ?? (async () => {})
  const before = await loadMergeState(options.io, options.home)
  const queueBefore = { pending: 0, retry: 0, skipped: 0 }
  for (const row of before.state.rows) queueBefore[row.queue] += 1
  const candidates = await options.ports.screening(options.signal)
  const pairs: MergeReportPair[] = []
  const totals = { merged: 0, kept: 0, pending: 0, failed: 0 }
  const remaining: { pairKey: string; queue: ReturnType<typeof queueOf> }[] = []
  let stopReason: MergeRunReportDraft['stopReason'] = 'completed'

  for (let index = 0; index < candidates.length; index += 1) {
    if (options.signal.aborted) {
      stopReason = 'cancelled'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'retry' as const })))
      break
    }
    const candidate = candidates[index] as MergeCandidate
    await stage('decide', { done: index, total: candidates.length })
    let row: MergeRow
    try {
      const created = transition(undefined, { type: 'candidate', a: candidate.a, b: candidate.b, at: at(options.now) })
      if (!created.ok || created.row === null) throw new Error(created.ok ? 'candidate row missing' : created.message)
      row = created.row
      await upsertRow(options.io, options.home, options.now, row)
    } catch (error) {
      totals.failed += 1
      pairs.push({
        id: '', pairKey: pairKey(candidate.a, candidate.b), a: candidate.a, b: candidate.b, queue: 'retry',
        candidate, outcome: 'failed', archived: [], failure: failureOf('screening', error),
      })
      continue
    }

    let round1: ScanRound1Outcome
    try {
      round1 = await options.ports.round1(candidate, options.signal)
    } catch (error) {
      round1 = { kind: 'failed', failure: failureOf('decide', error) }
    }
    if (round1.kind === 'failed') {
      const next = transition(row, { type: 'round1-fail', failure: round1.failure ?? failureOf('decide', 'round1 failed'), at: at(options.now) })
      if (next.ok && next.row !== null) { row = next.row; await upsertRow(options.io, options.home, options.now, row) }
      pairs.push(pairOf(row, candidate, 'failed', { failure: round1.failure ?? failureOf('decide', 'round1 failed') }))
      totals.failed += 1
      continue
    }
    if (round1.kind === 'keep') {
      const next = transition(row, { type: 'round1-keep', at: at(options.now) })
      if (next.ok && next.row !== null) { row = next.row; await upsertRow(options.io, options.home, options.now, row) }
      pairs.push(pairOf(row, candidate, 'kept', round1.decision === undefined ? {} : { decision: round1.decision }))
      totals.kept += 1
      continue
    }
    if (round1.decision === undefined) {
      pairs.push(pairOf(row, candidate, 'failed', { failure: failureOf('decide', 'merge decision missing') }))
      totals.failed += 1
      continue
    }
    if (options.approval) {
      const next = transition(row, { type: 'round1-merge', approval: 'on', at: at(options.now) })
      if (next.ok && next.row !== null) { row = next.row; await upsertRow(options.io, options.home, options.now, row) }
      pairs.push(pairOf(row, candidate, 'pending', { decision: round1.decision }))
      totals.pending += 1
      continue
    }

    const fuse = transition(row, { type: 'round1-merge', approval: 'off', at: at(options.now) })
    if (!fuse.ok || fuse.row === null) {
      pairs.push(pairOf(row, candidate, 'failed', { decision: round1.decision, failure: failureOf('decide', 'cannot enter fuse') }))
      totals.failed += 1
      continue
    }
    row = fuse.row
    await upsertRow(options.io, options.home, options.now, row)
    await stage('author', { done: index, total: candidates.length })
    let round2: ScanRound2Outcome
    try {
      round2 = await options.ports.round2(row, round1.decision, options.signal)
    } catch (error) {
      round2 = { kind: 'failed', failure: failureOf('author', error) }
    }
    if (round2.kind === 'merged') {
      const success = transition(row, { type: 'round2-success', at: at(options.now) })
      if (success.ok) await dropRow(options.io, options.home, options.now, row.id)
      pairs.push(pairOf(row, candidate, 'merged', {
        decision: round1.decision,
        ...(round2.unitId === undefined ? {} : { unitId: round2.unitId }),
        ...(round2.target === undefined ? {} : { target: round2.target }),
        archived: round2.archived ?? [],
      }))
      totals.merged += 1
      continue
    }
    const failed = round2.failure ?? failureOf('author', 'round2 failed')
    const next = transition(row, { type: 'round2-fail', failure: failed, at: at(options.now) })
    if (next.ok && next.row !== null) { row = next.row; await upsertRow(options.io, options.home, options.now, row) }
    pairs.push(pairOf(row, candidate, 'failed', { decision: round1.decision, failure: failed }))
    totals.failed += 1
  }

  return {
    stopReason,
    scope: { candidatePairs: candidates.length, queueBefore },
    pairs,
    totals,
    notes: [],
    ...(remaining.length === 0 ? {} : { remaining }),
  }
}
