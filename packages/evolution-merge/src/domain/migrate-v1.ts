/** Pure v1→v2 row migration. No IO. */
import type { MergeState } from './state.ts'

export interface LegacyMergeRow {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: 'verify' | 'pending' | 'fuse' | 'skipped'
  readonly queue?: 'pending' | 'retry' | 'skipped'
  readonly failure?: unknown
  readonly decision?: unknown
  readonly runId?: string
  readonly unitId?: string
  readonly origin?: 'agent' | 'human'
  readonly attempts?: number
  readonly stagingRef?: string
  readonly stagingExpiresAt?: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface V2Row {
  readonly schemaVersion: 2
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: MergeState
  readonly queue: 'verify' | 'pending' | 'fuse' | 'skipped'
  readonly failure?: unknown
  readonly decision?: unknown
  readonly runId?: string
  readonly unitId?: string
  readonly origin?: 'agent' | 'human'
  readonly attempts?: number
  readonly stagingRef?: string
  readonly stagingExpiresAt?: number
  readonly createdAt: string
  readonly updatedAt: string
}

export function migrateV1Row(row: LegacyMergeRow): V2Row {
  const queue = row.state === 'pending' ? 'pending' : row.state === 'skipped' ? 'skipped' : row.state === 'fuse' ? 'fuse' : 'verify'
  return {
    schemaVersion: 2,
    id: row.id,
    pairKey: row.pairKey,
    a: row.a,
    b: row.b,
    state: row.state,
    queue,
    ...(row.failure === undefined ? {} : { failure: row.failure }),
    ...(row.decision === undefined ? {} : { decision: row.decision }),
    ...(row.runId === undefined ? {} : { runId: row.runId }),
    ...(row.unitId === undefined ? {} : { unitId: row.unitId }),
    ...(row.origin === undefined ? {} : { origin: row.origin }),
    ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
    ...(row.stagingRef === undefined ? {} : { stagingRef: row.stagingRef }),
    ...(row.stagingExpiresAt === undefined ? {} : { stagingExpiresAt: row.stagingExpiresAt }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
