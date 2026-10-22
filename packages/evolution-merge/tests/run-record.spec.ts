// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { allCommittedUndone, deriveMergeStatus, type RunRecordV2 } from '../src/domain/run-record.ts'

const base: RunRecordV2 = {
  id: 'run-1', kind: 'merge', status: 'running', approval: 'off',
  startedAt: 1, updatedAt: 1, pairs: [],
}

it('running without pending stays running', () => {
  assert.equal(deriveMergeStatus(base), 'running')
})

it('approval on with pending becomes awaiting-approval', () => {
  const record: RunRecordV2 = { ...base, approval: 'on', pairs: [{ pairKey: 'a', a: 'a', b: 'b', result: 'pending' }] }
  assert.equal(deriveMergeStatus(record), 'awaiting-approval')
})

it('all committed pairs undone becomes undone', () => {
  const record: RunRecordV2 = { ...base, status: 'succeeded', pairs: [{ pairKey: 'a', a: 'a', b: 'b', result: 'undone', committed: true }] }
  assert.equal(deriveMergeStatus(record), 'undone')
  assert.equal(allCommittedUndone(record), true)
})

it('partial undone remains succeeded', () => {
  const record: RunRecordV2 = { ...base, status: 'succeeded', pairs: [
    { pairKey: 'a', a: 'a', b: 'b', result: 'undone', committed: true },
    { pairKey: 'c', a: 'c', b: 'd', result: 'merged', committed: true },
  ] }
  assert.equal(deriveMergeStatus(record), 'succeeded')
  assert.equal(allCommittedUndone(record), false)
})

it('terminal statuses project directly', () => {
  assert.equal(deriveMergeStatus({ ...base, status: 'failed' }), 'failed')
  assert.equal(deriveMergeStatus({ ...base, status: 'cancelled' }), 'cancelled')
  assert.equal(deriveMergeStatus({ ...base, status: 'interrupted' }), 'interrupted')
  assert.equal(deriveMergeStatus({ ...base, status: 'orphan' }), 'orphan')
})

it('superseded wins over success', () => {
  assert.equal(deriveMergeStatus({ ...base, status: 'succeeded', supersededAt: 2 }), 'superseded')
})
