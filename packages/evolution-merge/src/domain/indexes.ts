/** Pure pairKey result index and archived-history projection. No IO. */
export interface PairIndexEntryV2 {
  readonly pairKey: string
  readonly runId: string
  readonly result: 'merged' | 'kept' | 'failed' | 'cancelled' | 'undone'
  readonly target?: string
  readonly reportRef?: string
}

export type HistoryKind = 'merged' | 'deleted' | 'split' | 'other'

export interface HistoryRecord {
  readonly name: string
  readonly kind: HistoryKind
  readonly reason: string
  readonly lastVersion: number
  readonly archivedAt: string
  readonly sourceRunId?: string
}

export function putPair(index: ReadonlyMap<string, PairIndexEntryV2>, entry: PairIndexEntryV2): Map<string, PairIndexEntryV2> {
  const next = new Map(index)
  next.set(entry.pairKey, entry)
  return next
}

export function historyRecord(input: HistoryRecord): HistoryRecord {
  return { ...input, lastVersion: Math.max(1, Math.trunc(input.lastVersion)) }
}

export function summarizeHistory(records: readonly HistoryRecord[]): Record<HistoryKind, number> {
  const counts: Record<HistoryKind, number> = { merged: 0, deleted: 0, split: 0, other: 0 }
  for (const record of records) counts[record.kind] += 1
  return counts
}
