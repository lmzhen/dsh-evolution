// @tier pre-tag
/** G2a/2a.2: the two-medium read comparison, whose whole purpose is to be ABLE to disagree. Case two is
 * the S1-B02 shape: the json side holds a record the other medium never had. */
import { expect, it } from 'vitest'
import { comparePendingReadings } from '../src/medium-comparison.ts'

const record = (id: string, status: string) => ({ id, kind: 'replay', summary: 'x', args: null, createdAt: 't', status })
const provider = (records: unknown[]) => ({ listPending: async () => records as never })

it('G2a/2a.2: two readings of the same state agree', async () => {
  const left = provider([record('a', 'pending'), record('b', 'resolved')])
  const right = provider([record('b', 'resolved'), record('a', 'pending')])
  const comparison = await comparePendingReadings(left, right)
  expect(comparison.consistent).toBe(true)
  expect(comparison.differences).toEqual([])
})

it('G2a/2a.2: a record only the left (json) side revived is reported', async () => {
  const left = provider([record('a', 'pending'), record('ghost', 'pending')])
  const right = provider([record('a', 'pending')])
  const comparison = await comparePendingReadings(left, right)
  expect(comparison.consistent).toBe(false)
  expect(comparison.differences).toHaveLength(1)
  expect(comparison.differences[0]?.id).toBe('ghost')
  expect(comparison.differences[0]?.verdict).toBe('left-only')
})

it('G2a/2a.2: a status disagreement is reported as such', async () => {
  const left = provider([record('a', 'executing')])
  const right = provider([record('a', 'pending')])
  const comparison = await comparePendingReadings(left, right)
  expect(comparison.consistent).toBe(false)
  expect(comparison.differences[0]?.verdict).toBe('status-differs')
})
