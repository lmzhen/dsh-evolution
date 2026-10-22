/** Pure RunRecord v2 types and derived 9-state projection. No IO. */
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'orphan'

export type MergeStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'awaiting-approval'
  | 'undone'
  | 'superseded'
  | 'interrupted'
  | 'orphan'

export type PairResult = 'pending' | 'merged' | 'kept' | 'failed' | 'cancelled' | 'undone'

export interface PairRecord {
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly result: PairResult
  readonly target?: { readonly requested: string; readonly actual?: string; readonly created?: boolean }
  readonly stagingRef?: string
  readonly committed?: boolean
}

export interface PairIndexEntry {
  readonly pairKey: string
  readonly runId: string
  readonly result: PairResult
  readonly target?: string
  readonly reportRef?: string
}

export interface RunRecordV2 {
  readonly id: string
  readonly kind: 'merge'
  readonly status: RunStatus
  readonly stage?: 'screening' | 'decide' | 'author' | 'commit' | 'settle'
  readonly approval?: 'on' | 'off'
  readonly parentRunId?: string
  readonly pairKey?: string
  readonly plane?: 'local' | 'foreign'
  readonly startedAt: number
  readonly updatedAt: number
  readonly endedAt?: number
  readonly resultRef?: string
  readonly failure?: string
  readonly stagingRef?: string
  readonly pairs: readonly PairRecord[]
  readonly supersededAt?: number
}

export function deriveMergeStatus(record: RunRecordV2): MergeStatus {
  if (record.supersededAt !== undefined) return 'superseded'
  if (record.status === 'interrupted') return 'interrupted'
  if (record.status === 'orphan') return 'orphan'
  if (record.status === 'failed' || record.status === 'cancelled') return record.status
  if (record.status === 'running') {
    return record.approval === 'on' && record.pairs.some(pair => pair.result === 'pending')
      ? 'awaiting-approval'
      : 'running'
  }
  const committed = record.pairs.filter(pair => pair.committed === true)
  if (committed.length > 0 && committed.every(pair => pair.result === 'undone')) return 'undone'
  return 'succeeded'
}

export function allCommittedUndone(record: RunRecordV2): boolean {
  const committed = record.pairs.filter(pair => pair.committed === true)
  return committed.length > 0 && committed.every(pair => pair.result === 'undone')
}
