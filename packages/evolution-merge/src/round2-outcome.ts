/**
 * Shared round2 outcome recorder for approve and resume: one place decides whether the
 * row is dropped (commit landed) or kept in fuse with a failure. No report/registry logic.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { v3ToLegacy } from './domain/row-v3-bridge.ts'
import type { MergeFailure, MergeReportPair, MergeRow } from './contracts.ts'
import { dropRowV3, transactRows } from './state.ts'
import { recordPair } from './domain/pair-index-store.ts'
import type { ScanRound2Outcome } from './scan-run.ts'

export interface Round2Record {
  readonly pair: MergeReportPair
  readonly merged: boolean
}

export async function recordRound2Outcome(
  io: EvolutionIoLike,
  home: string,
  now: () => number,
  row: MergeRow,
  outcome: ScanRound2Outcome,
): Promise<Round2Record> {
  void now
  if (outcome.kind === 'merged') {
    {
      const dropped = await dropRowV3(io, home, row.id, 'committed', outcome.unitId ?? 'unknown')
      if (!dropped) return { merged: false, pair: { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue, outcome: 'failed', archived: [], failure: { stage: 'commit', code: 'row-changed', message: 'row changed before commit record', retryable: true, retryFrom: 'agent2' } } }
      const target = outcome.target?.actual ?? outcome.target?.requested ?? row.decision?.target
      await recordPair(io, home, {
        pairKey: row.pairKey,
        runId: row.runId ?? 'merge',
        result: 'merged',
        ...(target === undefined ? {} : { target }),
        ...(outcome.unitId === undefined ? {} : { reportRef: outcome.unitId }),
      })
    }
    return {
      merged: true,
      pair: {
        id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue,
        ...(row.decision === undefined ? {} : { decision: row.decision }),
        outcome: 'merged', archived: outcome.archived ?? [],
        ...(outcome.unitId === undefined ? {} : { unitId: outcome.unitId }),
        ...(outcome.target === undefined ? {} : { target: outcome.target }),
      },
    }
  }
  const failure: MergeFailure = outcome.failure ?? { stage: 'author', code: 'merge-failed', message: 'round2 failed', retryable: true, retryFrom: 'agent2' }
  const projected = await transactRows(io, home, tx => {
    const current = tx.rows().find(item => item.id === row.id)
    if (current === undefined) return null
    const moved = tx.transition(row.id, { type: 'failed', failure }, current.version)
    return moved.ok && moved.row !== null ? v3ToLegacy(moved.row) : null
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
