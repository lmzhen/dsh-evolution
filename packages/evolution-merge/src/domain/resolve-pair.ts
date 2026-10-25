/** Pure pair-index lookup. No run-record merge fields. */
import type { PairIndexEntryV2 } from './indexes.ts'

export function findPairRun(pairs: readonly PairIndexEntryV2[], pairKey: string): PairIndexEntryV2 | undefined {
  return pairs.find(entry => entry.pairKey === pairKey)
}
