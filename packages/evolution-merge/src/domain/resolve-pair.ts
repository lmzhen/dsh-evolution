/** Pure pairKey lookup over run records. No IO. */
import type { PairIndexEntryV2 } from './indexes.ts'
import type { PairRecord } from './run-record.ts'

export interface PairRunLike {
  readonly id: string
  readonly pairKey?: string
  readonly pairs: readonly PairRecord[]
  readonly resultRef?: string
}

export function findPairRun(runs: readonly PairRunLike[], pairKey: string): PairIndexEntryV2 | undefined {
  for (const run of runs) {
    if (run.pairKey === pairKey) {
      return { pairKey, runId: run.id, result: 'merged', ...(run.resultRef === undefined ? {} : { reportRef: run.resultRef }) }
    }
    const pair = run.pairs.find(item => item.pairKey === pairKey)
    if (pair !== undefined) {
      return {
        pairKey, runId: run.id, result: pair.result === 'undone' ? 'undone' : pair.result === 'kept' ? 'kept' : pair.result === 'failed' ? 'failed' : pair.result === 'cancelled' ? 'cancelled' : 'merged',
        ...(pair.target?.actual === undefined ? {} : { target: pair.target.actual }),
        ...(run.resultRef === undefined ? {} : { reportRef: run.resultRef }),
      }
    }
  }
  return undefined
}
