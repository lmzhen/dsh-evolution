// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { activeCounts, parseLedger, rowsOfQueue, upsert } from '../src/domain/ledger.ts'
import type { MergeRowV2 } from '../src/domain/row.ts'

const row = (pairKey: string, state: MergeRowV2['state'], extra: Partial<MergeRowV2> = {}): MergeRowV2 => ({
  id: 'mr_' + pairKey, pairKey, a: 'a', b: 'b', state, queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : state === 'fuse' ? 'fuse' : 'verify',
  createdAt: 'x', updatedAt: 'x', ...extra,
})

it('parses v2 rows and counts active only', () => {
  const parsed = parseLedger(JSON.stringify({ schemaVersion: 2, rows: [row('a', 'verify'), row('b', 'skipped'), row('c', 'pending', { expired: 'target-taken' })] }))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.ledger.rows.length, 3)
  assert.deepEqual(activeCounts(parsed.ledger.rows), { verify: 1, pending: 0, fuse: 0, skipped: 1 })
})

it('parses v1 rows through migration', () => {
  const parsed = parseLedger(JSON.stringify({ schemaVersion: 1, rows: [{ id: 'mr_a', pairKey: 'a', a: 'a', b: 'b', state: 'fuse', queue: 'retry', createdAt: 'x', updatedAt: 'x' }] }))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.ledger.rows[0]?.queue, 'fuse')
  assert.equal(parsed.ledger.rows[0]?.expired, undefined)
})

it('upsert replaces by pairKey and rowsOfQueue filters', () => {
  const initial = [row('a', 'verify')]
  const next = upsert(initial, row('a', 'pending'))
  assert.equal(next.length, 1)
  assert.equal(next[0]?.state, 'pending')
  assert.equal(rowsOfQueue(next, 'pending').length, 1)
})

it('invalid json is reported, not silently empty', () => {
  const parsed = parseLedger('{bad')
  assert.equal(parsed.ok, false)
  assert.match(parsed.note ?? '', /invalid/)
})
