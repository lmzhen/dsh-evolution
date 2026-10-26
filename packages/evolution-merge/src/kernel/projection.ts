/** Pure projection over the ledger. One expired predicate, one queue mapping. */
import type { PairSnapshot } from './model.ts'
import type { LedgerState } from './ledger.ts'
import type { UnitSnapshot } from './unit.ts'

export type ProjectionQueue = 'verify' | 'pending' | 'fuse' | 'skipped'

export interface RowProjection {
  readonly id: string
  readonly pairKey: string
  readonly state: PairSnapshot['state']
  readonly queue: ProjectionQueue | null
  readonly expired: boolean
  readonly version: number
}

export interface ProjectionCounts {
  readonly active: Readonly<Record<ProjectionQueue, number>>
  readonly expired: number
}

export interface MergeProjection {
  readonly seq: number
  readonly rows: readonly RowProjection[]
  readonly units: readonly UnitSnapshot[]
  readonly counts: ProjectionCounts
}

export function queueOf(pair: PairSnapshot): ProjectionQueue | null {
  switch (pair.state) {
    case 'candidate':
    case 'deciding': return 'verify'
    case 'pending': return 'pending'
    case 'approved':
    case 'authoring':
    case 'staged':
    case 'committing':
    case 'unknown':
    case 'failed': return 'fuse'
    case 'closed': return 'skipped'
    case 'expired': return 'skipped'
    default: return null
  }
}

export function isExpired(pair: PairSnapshot, now: number): boolean {
  if (pair.state === 'expired') return true
  if (pair.expiresAt === undefined) return false
  if (pair.state !== 'pending' && pair.state !== 'staged') return false
  return pair.expiresAt <= now
}

export function project(state: LedgerState, now: number): MergeProjection {
  const counts = { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }
  const rows: RowProjection[] = []
  for (const pair of [...state.pairs.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const expired = isExpired(pair, now)
    const queue = queueOf(pair)
    rows.push({ id: pair.id, pairKey: pair.pairKey, state: pair.state, queue, expired, version: pair.version })
    if (expired) counts.expired += 1
    else if (queue !== null) counts.active[queue] += 1
  }
  const units = [...state.units.values()].sort((left, right) => left.unitId.localeCompare(right.unitId))
  return { seq: state.seq, rows, units, counts }
}

export function projectionJson(projection: MergeProjection): string {
  return JSON.stringify(projection)
}
