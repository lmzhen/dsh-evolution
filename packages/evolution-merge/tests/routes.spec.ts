// @tier pre-tag
import { expect, it } from 'vitest'
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { buildMergeView, pageQueue, toRunFact, type MergeRow } from '../src/index.ts'

const row = (a: string, b: string, state: MergeRow['state']): MergeRow => ({
  id: 'mr_' + a, pairKey: a + '\u0000' + b, a, b, state,
  queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : state === 'fuse' || state === 'approved' ? 'fuse' : 'verify',
  createdAt: 'x', updatedAt: 'x',
})

it('builds view counts/tabs and paginates a queue', () => {
  const rows = [row('a', 'b', 'verify'), row('c', 'd', 'pending'), row('e', 'f', 'fuse'), row('g', 'h', 'skipped')]
  const view = buildMergeView(rows, ['merge scan'])
  expect(view.counts).toEqual({ verify: 1, pending: 1, fuse: 1, skipped: 1 })
  expect(view.tabs).toEqual([{ queue: 'verify', count: 1 }, { queue: 'pending', count: 1 }, { queue: 'fuse', count: 1 }, { queue: 'skipped', count: 1 }])
  const page = pageQueue(rows, 'verify', 0, 1)
  expect(page.items).toHaveLength(1)
  expect(page.nextCursor).toBeUndefined()
  expect(pageQueue(rows, 'fuse', 0, 1).items[0]?.a).toBe('e')
})

it('projects a run fact with optional fields', () => {
  const run: RunRecord = { id: 'r1', kind: 'merge', state: 'running', startedAt: 1, command: 'scan', stage: 'author', progress: { done: 1, total: 2 } }
  expect(toRunFact(run)).toEqual({ id: 'r1', state: 'running', command: 'scan', stage: 'author', progress: { done: 1, total: 2 }, startedAt: 1 })
})
