// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { findPairRun } from '../src/domain/resolve-pair.ts'

it('finds a pair from the pair-index', () => {
  assert.deepEqual(findPairRun([{ pairKey: 'a', runId: 'r1', result: 'merged', reportRef: 'report' }, { pairKey: 'b', runId: 'r2', result: 'merged', target: 'u' }], 'a'), { pairKey: 'a', runId: 'r1', result: 'merged', reportRef: 'report' })
  assert.equal(findPairRun([{ pairKey: 'a', runId: 'r1', result: 'merged' }, { pairKey: 'b', runId: 'r2', result: 'merged', target: 'u' }], 'b')?.target, 'u')
  assert.equal(findPairRun([], 'missing'), undefined)
})
