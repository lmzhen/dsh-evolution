/**
 * Shared round2 outcome recorder for approve and resume: one place decides whether the
 * row is dropped (commit landed) or kept in fuse with a failure. No report/registry logic.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { v4ToLegacy } from './domain/row-v4.ts'
import type { MergeFailure, MergeReportPair, MergeRow } from './contracts.ts'
import { pairLedger } from './domain/pair-ledger.ts'
import { dropStage } from './domain/stage-aggregate.ts'
import { casExpiredHook } from './domain/failure-route.ts'
import { recordPair } from './domain/run-coordinator.ts'
import type { ScanRound2Outcome } from './scan-run.ts'

export interface Round2Record {
  readonly pair: MergeReportPair
  readonly merged: boolean
  readonly finalize?: () => Promise<void>
}

export async function recordRound2Outcome(
  io: EvolutionIoLike,
  home: string,
  now: () => number,
  row: MergeRow,
  outcome: ScanRound2Outcome,
  deferProjection = false,
): Promise<Round2Record> {
  void now
  if (outcome.kind === 'merged') {
    const unitRef = { unitId: outcome.unitId ?? 'unknown', evidenceSha256: outcome.evidenceSha256 ?? 'unknown' }
    const target = outcome.target?.actual ?? outcome.target?.requested ?? row.decision?.target
    const finalize = async (): Promise<void> => {
      const removed = await pairLedger(io, home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        return current === undefined ? { ok: false as const, code: 'row-not-found' as const, message: 'row not found' } : tx.remove(row.id, 'committed', unitRef, current.version)
      })
      if (!removed.ok) throw new Error('row changed before commit record: ' + row.id)
      await dropStage(io, home, row.id)
      await recordPair(io, home, {
        pairKey: row.pairKey,
        runId: row.runId ?? 'merge',
        result: 'merged',
        ...(target === undefined ? {} : { target }),
        ...(outcome.unitId === undefined ? {} : { reportRef: outcome.unitId }),
      })
    }
    if (deferProjection) return { merged: true, finalize, pair: { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue, ...(row.decision === undefined ? {} : { decision: row.decision }), outcome: 'merged', archived: outcome.archived ?? [], ...(outcome.unitId === undefined ? {} : { unitId: outcome.unitId }), ...(outcome.target === undefined ? {} : { target: outcome.target }) } }
    {
      await finalize()
    }
    return {
      merged: true,
      pair: {
        id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue,
        ...(row.decision === undefined ? {} : { decision: row.decision }),
        outcome: 'merged', archived: outcome.archived ?? [],
        ...(outcome.unitId === undefined ? {} : { unitId: outcome.unitId }),
        ...(outcome.target === undefined ? {} : { target: outcome.target }),
        ...(outcome.validationPlan === undefined ? {} : { validationPlan: outcome.validationPlan }),
      },
    }
  }
  const failure: MergeFailure = outcome.failure ?? { stage: 'author', code: 'merge-failed', message: 'round2 failed', retryable: true, retryFrom: 'agent2' }
  if (failure.code === 'merge-over-limit' || failure.code === 'limit' || failure.code === 'merge-validation') {
    const reason = failure.code === 'merge-validation' ? 'validation-failed' : 'merge-over-limit'
    const skipped = await pairLedger(io, home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      return current === undefined ? false : tx.transition(row.id, { type: 'skipped', reason, origin: 'system', skipSource: 'system' }, current.version).ok
    })
    if (skipped) await dropStage(io, home, row.id)
    return { merged: false, pair: { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue, ...(row.decision === undefined ? {} : { decision: row.decision }), outcome: 'failed', archived: [], failure } }
  }
  const cas = casExpiredHook(failure.code)
  if (cas !== null) {
    await pairLedger(io, home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      if (current === undefined) return false
      const moved = tx.transition(row.id, { type: 'skipped', reason: cas.reason, origin: 'system', skipSource: 'system' }, current.version)
      return moved.ok
    })
    await dropStage(io, home, row.id)
    return { merged: false, pair: { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue, ...(row.decision === undefined ? {} : { decision: row.decision }), outcome: 'failed', archived: [], failure: { ...failure, code: cas.reason, retryable: false, retryFrom: 'none' } } }
  }
  if (failure.code === 'commit-failed' || failure.code === 'validation-failed') {
    await pairLedger(io, home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      return current === undefined ? false : tx.remove(row.id, 'superseded', undefined, current.version).ok
    })
  }
  if (failure.code === 'source-gone') {
    await pairLedger(io, home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      return current === undefined ? false : tx.remove(row.id, 'superseded', undefined, current.version).ok
    })
    return { merged: false, pair: { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue, outcome: 'failed', archived: [], failure } }
  }
  const projected = await pairLedger(io, home).transact(tx => {
    const current = tx.rows().find(item => item.id === row.id)
    if (current === undefined) return null
    const moved = tx.transition(row.id, { type: 'failed', failure }, current.version)
    return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
  })
  if (projected === null) return { merged: false, pair: { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue, outcome: 'failed', archived: [], failure: { ...failure, code: 'row-changed', message: 'row changed before failure record' } } }
  {
    await recordPair(io, home, {
      pairKey: row.pairKey,
      runId: row.runId ?? 'merge',
      result: 'failed',
      ...(row.decision?.target === undefined ? {} : { target: row.decision.target }),
    })
  }
  return {
    merged: false,
    pair: {
      id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue,
      ...(row.decision === undefined ? {} : { decision: row.decision }),
      outcome: 'failed', archived: [], failure,
    },
  }
}
