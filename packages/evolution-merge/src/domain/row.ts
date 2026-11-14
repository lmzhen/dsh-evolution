/** The v2 row shape still read by the ledger/migration bridge. No IO. */
import type { MergeState } from './state.ts'
import type { MergeDecision, MergeFailure } from '../contracts.ts'

export interface MergeRowV2 {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: MergeState
  readonly queue: 'verify' | 'pending' | 'fuse' | 'skipped'
  readonly failure?: MergeFailure
  readonly decision?: MergeDecision
  readonly sourceRevision?: string
  readonly targetRevision?: string
  readonly runId?: string
  readonly unitId?: string
  readonly origin?: 'agent' | 'human' | 'system'
  readonly attempts?: number
  readonly version?: number
  readonly stagingRef?: string
  readonly stagingExpiresAt?: number
  readonly target?: { readonly requested: string; readonly actual?: string; readonly created?: boolean }
  readonly reason?: string
  readonly expired?: 'target-taken' | 'source-changed'
  readonly createdAt: string
  readonly updatedAt: string
}
