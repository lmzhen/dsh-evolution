// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { historyRecord, summarizeHistory } from '../src/domain/indexes.ts'

it('history keeps last version and counts four kinds', () => {
  const records = [
    historyRecord({ name: 'a', kind: 'merged', reason: 'x', lastVersion: 0, archivedAt: 't' }),
    historyRecord({ name: 'b', kind: 'deleted', reason: 'x', lastVersion: 2, archivedAt: 't' }),
    historyRecord({ name: 'c', kind: 'split', reason: 'x', lastVersion: 1, archivedAt: 't' }),
  ]
  assert.equal(records[0]?.lastVersion, 1)
  assert.deepEqual(summarizeHistory(records), { merged: 1, deleted: 1, split: 1, other: 0 })
})
