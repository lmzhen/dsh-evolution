// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { toRowView } from '../src/routes.ts'
import type { MergeRow } from '../src/contracts.ts'

it('row view exposes three summary lines', () => {
  const row: MergeRow = { id: 'mr_1', pairKey: 'a|b', a: 'alpha', b: 'beta', state: 'fuse', queue: 'fuse', decision: { shouldMerge: true, mode: 'merge-into-existing', target: 't', sources: ['alpha', 'beta'], rationale: 'same topic' }, createdAt: 'x', updatedAt: 'x' }
  assert.deepEqual(toRowView(row).summary, ['alpha + beta', 'same topic', ''])
})
