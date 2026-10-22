// @tier pre-tag
import assert from 'node:assert/strict'
import test from 'node:test'
import { historyRecord, putPair, summarizeHistory } from '../src/domain/indexes.ts'

test('pair index put replaces by pairKey', () => {
  const first = putPair(new Map(), { pairKey: 'a', runId: 'r1', result: 'merged' })
  const second = putPair(first, { pairKey: 'a', runId: 'r2', result: 'undone' })
  assert.equal(second.get('a')?.runId, 'r2')
  assert.equal(second.size, 1)
})

test('history keeps last version and counts four kinds', () => {
  const records = [
    historyRecord({ name: 'a', kind: 'merged', reason: 'x', lastVersion: 0, archivedAt: 't' }),
    historyRecord({ name: 'b', kind: 'deleted', reason: 'x', lastVersion: 2, archivedAt: 't' }),
    historyRecord({ name: 'c', kind: 'split', reason: 'x', lastVersion: 1, archivedAt: 't' }),
  ]
  assert.equal(records[0]?.lastVersion, 1)
  assert.deepEqual(summarizeHistory(records), { merged: 1, deleted: 1, split: 1, other: 0 })
})
