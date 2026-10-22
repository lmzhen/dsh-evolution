// @tier pre-tag
import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePairIndex, serializePairIndex } from '../src/domain/pair-index.ts'

test('round-trips pair index and drops invalid entries', () => {
  const raw = JSON.stringify({ schemaVersion: 1, entries: [
    { pairKey: 'a', runId: 'r1', result: 'merged' },
    { pairKey: 'b', runId: 'r2', result: 'nope' },
    { pairKey: 'c' },
  ] })
  const index = parsePairIndex(raw)
  assert.equal(index.size, 1)
  const again = parsePairIndex(serializePairIndex(index))
  assert.equal(again.get('a')?.runId, 'r1')
})

test('missing file is empty; bad json is empty', () => {
  assert.equal(parsePairIndex(null).size, 0)
  assert.equal(parsePairIndex('{bad').size, 0)
})
