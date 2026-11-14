/** Pure pairKey result index and archived-history projection. No IO. */
export type HistoryKind = 'merged' | 'deleted' | 'split' | 'other'

export interface HistoryRecord {
  readonly name: string
  readonly kind: HistoryKind
  readonly reason: string
  readonly lastVersion: number
  readonly archivedAt: string
  readonly sourceRunId?: string
}

export function historyRecord(input: HistoryRecord): HistoryRecord {
  return { ...input, lastVersion: Math.max(1, Math.trunc(input.lastVersion)) }
}

export function summarizeHistory(records: readonly HistoryRecord[]): Record<HistoryKind, number> {
  const counts: Record<HistoryKind, number> = { merged: 0, deleted: 0, split: 0, other: 0 }
  for (const record of records) counts[record.kind] += 1
  return counts
}
