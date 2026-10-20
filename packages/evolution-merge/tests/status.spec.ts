// @tier pre-tag
import { expect, it } from 'vitest'
import { countRows, formatQueue, formatStatus, type MergeRow } from '../src/index.ts'

const row = (a: string, b: string, state: MergeRow['state'], failure?: MergeRow['failure']): MergeRow => ({
  id: 'mr_' + a, pairKey: a + '\u0000' + b, a, b, state, queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : 'retry',
  createdAt: 'x', updatedAt: 'x', ...(failure === undefined ? {} : { failure }),
})

it('counts and formats the three queues', () => {
  const rows = [row('a', 'b', 'verify'), row('c', 'd', 'pending'), row('e', 'f', 'fuse'), row('g', 'h', 'skipped')]
  expect(countRows(rows)).toEqual({ pending: 1, retry: 2, skipped: 1 })
  const text = formatStatus(rows)
  expect(text).toContain('pending 1, retry 2, skipped 1')
  expect(formatQueue(rows, 'pending')).toContain('c + d')
  expect(formatQueue(rows, 'retry')).toContain('a + b')
  expect(formatQueue([], 'skipped')).toBe('merge skipped: empty')
  const decided: MergeRow = { ...row('i', 'j', 'pending'), decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'umbrella', sources: ['i', 'j'], rationale: 'same' } }
  expect(formatStatus([decided])).toContain('→ umbrella')
})
