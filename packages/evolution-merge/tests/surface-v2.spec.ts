// @tier pre-tag
import assert from 'node:assert/strict'
import test from 'node:test'
import { countRows } from '../src/status.ts'
import { buildMergeView } from '../src/routes.ts'
import type { MergeRow } from '../src/contracts.ts'

const row = (state: MergeRow['state'], queue: MergeRow['queue']): MergeRow => ({
  id: 'mr_' + state, pairKey: state, a: 'a', b: 'b', state, queue, createdAt: 'x', updatedAt: 'x',
})

test('counts four queues', () => {
  const counts = countRows([row('verify', 'verify'), row('pending', 'pending'), row('approved', 'fuse'), row('skipped', 'skipped')])
  assert.deepEqual(counts, { verify: 1, pending: 1, fuse: 1, skipped: 1 })
})

test('view has four tabs and schemaVersion 2', () => {
  const view = buildMergeView([], [])
  assert.equal(view.schemaVersion, 2)
  assert.deepEqual(view.tabs.map(tab => tab.queue), ['verify', 'pending', 'fuse', 'skipped'])
})
