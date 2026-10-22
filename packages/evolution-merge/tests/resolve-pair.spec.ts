// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { findPairRun } from '../src/domain/resolve-pair.ts'

it('finds a committed pair by pairKey or pairs[]', () => {
  const runs = [
    { id: 'r1', pairKey: 'a', pairs: [], resultRef: 'report' },
    { id: 'r2', pairs: [{ pairKey: 'b', a: 'b', b: 'c', result: 'merged' as const, target: { requested: 't', actual: 'u' }, committed: true }] },
  ]
  assert.deepEqual(findPairRun(runs, 'a'), { pairKey: 'a', runId: 'r1', result: 'merged', reportRef: 'report' })
  assert.equal(findPairRun(runs, 'b')?.runId, 'r2')
  assert.equal(findPairRun(runs, 'b')?.target, 'u')
  assert.equal(findPairRun(runs, 'missing'), undefined)
})
