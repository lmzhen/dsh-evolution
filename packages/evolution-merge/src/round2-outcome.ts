/**
 * Shared round2 outcome recorder for approve and resume: one place decides whether the
 * row is dropped (commit landed) or kept in fuse with a failure. No report/registry logic.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { transition } from './coordinator.ts'
import type { MergeFailure, MergeReportPair, MergeRow } from './contracts.ts'
import { dropRow, upsertRow } from './state.ts'
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
  const at = new Date(now()).toISOString()
  if (outcome.kind === 'merged') {
    const success = transition(row, { type: 'round2-success', at })
    if (success.ok) await dropRow(io, home, now, row.id)
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
  const next = transition(row, { type: 'round2-fail', failure, at })
  if (next.ok && next.row !== null) await upsertRow(io, home, now, next.row)
  return {
    merged: false,
    pair: {
      id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, queue: row.queue,
      ...(row.decision === undefined ? {} : { decision: row.decision }),
      outcome: 'failed', archived: [], failure,
    },
  }
}
