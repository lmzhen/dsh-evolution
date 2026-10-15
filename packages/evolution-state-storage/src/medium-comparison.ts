/**
 * G2a/2a.2: the two-medium read comparison.
 *
 * Audit S1-B02: switching back to the json medium revives staged records the other medium never had
 * (the json read face merges a legacy `pending.json`, which re-introduces an evicted record), and the
 * default TTL of 0 makes age no threshold at all. The fix is not a third store - it is being able to SEE
 * the disagreement: the SAME logical state read through both providers must agree.
 *
 * This lives in the seam package because that is the layer the two providers share. Comparing the
 * packages' own file reads would bypass the seam and stop working the moment a provider is swapped.
 *
 * Read-only: it reports, it never writes and never repairs.
 */
import type { EvolutionStateStorage, PendingRecord, PendingStatus } from './index.ts'

/** One record that the two readings do not agree on. */
export interface MediumDifference {
  readonly id: string
  readonly left: PendingStatus | undefined
  readonly right: PendingStatus | undefined
  /** `left-only` is the revival shape: the json side holds a record the other medium never had. */
  readonly verdict: 'left-only' | 'right-only' | 'status-differs'
}

/** The comparison result. `consistent: false` is the red signal S1-B02 asks for. */
export interface MediumComparison {
  readonly consistent: boolean
  /** One entry per record the readings disagree on, ordered by id. */
  readonly differences: readonly MediumDifference[]
}

/**
 * Compare the pending state as two media read it.
 * @param left - the provider currently in use.
 * @param right - the provider the deployment would switch to.
 * @returns whether the readings agree, and every disagreement, ordered by id.
 */
export async function comparePendingReadings(
  left: Pick<EvolutionStateStorage, 'listPending'>,
  right: Pick<EvolutionStateStorage, 'listPending'>,
): Promise<MediumComparison> {
  const [leftRecords, rightRecords] = await Promise.all([left.listPending(), right.listPending()])
  const statusOf = (records: readonly PendingRecord[]) => new Map(records.map(record => [record.id, record.status]))
  const leftStatus = statusOf(leftRecords)
  const rightStatus = statusOf(rightRecords)
  const ids = [...new Set([...leftStatus.keys(), ...rightStatus.keys()])].sort()
  const differences: MediumDifference[] = []
  for (const id of ids) {
    const leftValue = leftStatus.get(id)
    const rightValue = rightStatus.get(id)
    if (leftValue === rightValue) continue
    const verdict = leftValue === undefined ? 'right-only'      : rightValue === undefined ? 'left-only' : 'status-differs'
    differences.push({ id, left: leftValue, right: rightValue, verdict })
  }
  return { consistent: differences.length === 0, differences }
}
