/**
 * The scan pair loop. Registry/report lifecycle stays in withMergeRun; this module owns
 * candidate → round1 → pending/fuse → commit transitions and returns the report draft.
 */
import {
  pairKey,
  rowIdOf,
  queueOf,
  type MergeCandidate,
  type MergeDecision,
  type MergeFailure,
  type MergeReportPair,
  type MergeRow,
} from './contracts.ts'
import { dropRowV3, loadMergeState, transactRows } from './state.ts'
import { recordPair } from './domain/pair-index-store.ts'
import { writeStagingIndex } from './domain/staging-index.ts'
import { v3ToLegacy } from './domain/row-v3-bridge.ts'
import type { EvolutionIoLike, RunStage } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRunReportDraft } from './run-shell.ts'

const isAborted = (signal: AbortSignal): boolean => signal.aborted

export interface ScanRound1Outcome {
  readonly kind: 'keep' | 'merge' | 'failed'
  readonly decision?: MergeDecision
  readonly failure?: MergeFailure
  readonly stagingRef?: string
  readonly stagingExpiresAt?: number
  readonly sourceRevision?: string
  readonly targetRevision?: string
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
  readonly timeoutMinutes?: number
  readonly startedAt?: number
  readonly ports: ScanPorts
  readonly stage?: (stage: RunStage, progress?: { done: number; total: number }) => Promise<void>
  readonly notes?: readonly string[]
  readonly runId?: string
  readonly isOwnerActive?: (runId: string) => boolean | Promise<boolean>
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
    ...(candidate.gate === undefined ? {} : { gate: candidate.gate }),
    outcome,
    archived: [],
    ...extra,
  }
}

export async function runScan(options: RunScanOptions): Promise<MergeRunReportDraft> {
  const stage = options.stage ?? (async () => {})
  const candidates = await options.ports.screening(options.signal)
  const before = await loadMergeState(options.io, options.home)
  if (!before.ok) throw new Error(before.note ?? 'merge-state-invalid')
  const queueBefore = { verify: 0, pending: 0, fuse: 0, skipped: 0 }
  for (const row of before.state.rows) queueBefore[row.queue] += 1
  const startedAt = options.startedAt ?? options.now()
  const timeoutMs = (options.timeoutMinutes ?? 0) > 0 ? (options.timeoutMinutes as number) * 60_000 : 0
  const pairs: MergeReportPair[] = []
  const totals = { merged: 0, kept: 0, pending: 0, failed: 0 }
  const remaining: { pairKey: string; queue: ReturnType<typeof queueOf> }[] = []
  let stopReason: MergeRunReportDraft['stopReason'] = 'completed'

  for (let index = 0; index < candidates.length; index += 1) {
    if (isAborted(options.signal)) {
      stopReason = 'cancelled'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'verify' as const })))
      break
    }
    if (timeoutMs > 0 && options.now() - startedAt >= timeoutMs) {
      stopReason = 'timeout'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'verify' as const })))
      break
    }
    const candidate = candidates[index] as MergeCandidate
    await stage('decide', { done: index, total: candidates.length })
    let row: MergeRow
    try {
      const key = pairKey(candidate.a, candidate.b)
      const atNow = at(options.now)
      row = { id: rowIdOf(key), pairKey: key, a: candidate.a, b: candidate.b, state: 'verify', queue: 'verify', createdAt: atNow, updatedAt: atNow, ...(options.runId === undefined ? {} : { runId: options.runId }) }
      const before = (await loadMergeState(options.io, options.home)).state.rows.find(item => item.pairKey === row.pairKey)
      if (before?.state === 'verify' && before.runId !== undefined && before.runId !== options.runId
        && (await options.isOwnerActive?.(before.runId)) === true) {
        continue
      }
      const status = await transactRows(options.io, options.home, tx => {
        const current = tx.rows().find(item => item.pairKey === row.pairKey)
        if (current !== undefined && current.state !== 'verify' && current.state !== 'skipped') return 'conflict:' + current.state
        if (current?.state === 'skipped') {
          const removed = tx.transition(current.id, { type: 'restored' }, current.version)
          if (!removed.ok) return 'restore-failed'
        }
        if (current?.state === 'verify') return 'existing'
        const made = tx.createVerify({
          id: current?.id ?? rowIdOf(row.pairKey), pairKey: row.pairKey, a: row.a, b: row.b,
          version: 0, createdAt: at(options.now), updatedAt: at(options.now), origin: 'agent',
          state: 'verify', verifySubState: 'unverified', attempts: 0,
          ...(row.runId === undefined ? {} : { runId: row.runId }),
        })
        return made.ok ? 'created' : 'invalid:' + made.code
      })
      if (status.startsWith('conflict:')) throw new Error('pair already in ' + status.slice(9))
      if (status === 'restore-failed' || status.startsWith('invalid:')) throw new Error('cannot place verify row: ' + status)
    } catch (error) {
      totals.failed += 1
      pairs.push({
        id: '', pairKey: pairKey(candidate.a, candidate.b), a: candidate.a, b: candidate.b, queue: 'verify',
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
    if (isAborted(options.signal)) {
      stopReason = 'cancelled'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'verify' as const })))
      break
    }
    if (round1.kind === 'failed') {
      const failure = round1.failure ?? failureOf('decide', 'round1 failed')
      const projected = await transactRows(options.io, options.home, tx => {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) return null
        const moved = tx.transition(row.id, { type: 'failed', failure }, current.version)
        return moved.ok && moved.row !== null ? v3ToLegacy(moved.row) : null
      })
      if (projected === null) { pairs.push(pairOf(row, candidate, 'failed', { failure: failureOf('decide', 'row changed before failure record') })); totals.failed += 1; continue }
      row = projected
      pairs.push(pairOf(row, candidate, 'failed', { failure }))
      totals.failed += 1
      continue
    }
    if (round1.kind === 'keep') {
      const projected = await transactRows(options.io, options.home, tx => {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) return null
        const moved = tx.transition(row.id, { type: 'skipped', reason: 'kept' }, current.version)
        return moved.ok && moved.row !== null ? v3ToLegacy(moved.row) : null
      })
      if (projected === null) { pairs.push(pairOf(row, candidate, 'failed', { failure: failureOf('decide', 'row changed before keep record') })); totals.failed += 1; continue }
      row = projected
      await recordPair(options.io, options.home, { pairKey: row.pairKey, runId: row.runId ?? 'merge', result: 'kept' })
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
      const event = { type: 'verify-passed' as const, decision: round1.decision, target: round1.decision.target, ...(round1.sourceRevision === undefined ? {} : { sourceRevision: round1.sourceRevision }) }
      const projected = await transactRows(options.io, options.home, tx => {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) return null
        const moved = tx.transition(row.id, event, current.version)
        return moved.ok && moved.row !== null ? v3ToLegacy(moved.row) : null
      })
      if (projected === null) { pairs.push(pairOf(row, candidate, 'failed', { decision: round1.decision, failure: failureOf('decide', 'row changed before pending record') })); totals.failed += 1; continue }
      row = projected
      pairs.push(pairOf(row, candidate, 'pending', { decision: round1.decision }))
      totals.pending += 1
      continue
    }

    const staged = await transactRows(options.io, options.home, tx => {
      const current = tx.rows().find(item => item.id === row.id)
      if (current === undefined) return null
      const approved = tx.transition(row.id, { type: 'auto-approved', decision: round1.decision!, target: round1.decision!.target, ...(row.runId === undefined ? {} : { runId: row.runId }) }, current.version)
      if (!approved.ok || approved.row === null) return null
      const moved = tx.transition(row.id, { type: 'staged', ...(round1.stagingRef === undefined ? {} : { ref: round1.stagingRef }), ...(round1.stagingExpiresAt === undefined ? {} : { expiresAt: round1.stagingExpiresAt }) }, approved.row.version)
      return moved.ok && moved.row !== null ? v3ToLegacy(moved.row) : null
    })
    if (staged === null) {
      pairs.push(pairOf(row, candidate, 'failed', { decision: round1.decision, failure: failureOf('author', 'row changed before staging record') }))
      totals.failed += 1
      continue
    }
    row = staged
    if (round1.stagingRef !== undefined) {
      const expiresAt = round1.stagingExpiresAt ?? options.now() + 7 * 86_400_000
      await writeStagingIndex(options.io, options.home, { rowId: row.id, pairKey: row.pairKey, ref: round1.stagingRef, expiresAt, ...(row.runId === undefined ? {} : { runId: row.runId }), createdAt: options.now() })
    }
    if (isAborted(options.signal)) {
      const projected = await transactRows(options.io, options.home, tx => {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) return null
        const moved = tx.transition(row.id, { type: 'skipped', reason: 'cancelled' }, current.version)
        return moved.ok && moved.row !== null ? v3ToLegacy(moved.row) : null
      })
      if (projected !== null) row = projected
      stopReason = 'cancelled'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'fuse' as const })))
      break
    }
    await stage('author', { done: index, total: candidates.length })
    let round2: ScanRound2Outcome
    try {
      round2 = await options.ports.round2(row, round1.decision, options.signal)
    } catch (error) {
      round2 = { kind: 'failed', failure: failureOf('author', error) }
    }
    if (round2.kind === 'merged') {
      const dropped = await dropRowV3(options.io, options.home, row.id, 'committed', round2.unitId ?? 'unknown')
      if (!dropped) {
        pairs.push(pairOf(row, candidate, 'failed', { decision: round1.decision, failure: failureOf('commit', 'row changed before commit record') }))
        totals.failed += 1
        continue
      }
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
    const projected = await transactRows(options.io, options.home, tx => {
      const current = tx.rows().find(item => item.id === row.id)
      if (current === undefined) return null
      const moved = tx.transition(row.id, { type: 'failed', failure: failed }, current.version)
      return moved.ok && moved.row !== null ? v3ToLegacy(moved.row) : null
    })
    if (projected === null) { pairs.push(pairOf(row, candidate, 'failed', { decision: round1.decision, failure: failureOf('author', 'row changed before failure record') })); totals.failed += 1; continue }
    row = projected
    pairs.push(pairOf(row, candidate, 'failed', { decision: round1.decision, failure: failed }))
    totals.failed += 1
  }

  return {
    stopReason,
    scope: {
      candidatePairs: (candidates as readonly MergeCandidate[] & { readonly candidatePairs?: number }).candidatePairs ?? candidates.length,
      queueBefore,
    },
    pairs,
    totals,
    notes: [ ...(options.notes ?? []) ],
    ...(remaining.length === 0 ? {} : { remaining }),
  }
}
