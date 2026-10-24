// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { countRows } from '../src/status.ts'
import { buildFacts } from '../src/facts.ts'
import type { MergeRow } from '../src/contracts.ts'

const row = (state: MergeRow['state'], queue: MergeRow['queue']): MergeRow => ({
  id: 'mr_' + state, pairKey: state, a: 'a', b: 'b', state, queue, createdAt: 'x', updatedAt: 'x',
})

it('counts four queues', () => {
  const counts = countRows([row('verify', 'verify'), row('pending', 'pending'), row('approved', 'fuse'), row('skipped', 'skipped')])
  assert.deepEqual(counts, { verify: 1, pending: 1, fuse: 1, skipped: 1 })
})

it('facts expose wireVersion 1 and four queue counts', () => {
  const facts = buildFacts({ rows: [], runs: [], approval: false, readAt: 1 })
  assert.equal(facts.wireVersion, 1)
  assert.deepEqual(facts.counts, { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 })
})
