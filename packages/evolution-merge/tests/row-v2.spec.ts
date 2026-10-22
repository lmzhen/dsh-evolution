// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { transitionRow, type MergeRowEvent, type MergeRowV2 } from '../src/domain/row.ts'

const AT = '2026-10-20T00:00:00.000Z'
const failure = { stage: 'author' as const, code: 'E', message: 'boom', retryable: true, retryFrom: 'agent2' as const }

function apply(row: MergeRowV2, event: MergeRowEvent): MergeRowV2 | null {
  const result = transitionRow(row, event)
  if (!result.ok) throw new Error(result.message)
  return result.row
}

function candidate(): MergeRowV2 {
  const result = transitionRow(undefined, { type: 'candidate', a: 'b', b: 'a', at: AT })
  if (!result.ok || result.row === null) throw new Error('candidate failed')
  return result.row
}

it('creates verify row with four-queue projection', () => {
  const row = candidate()
  assert.equal(row.state, 'verify')
  assert.equal(row.queue, 'verify')
})

it('round1 keep and approval routes', () => {
  const row = candidate()
  assert.equal(apply(row, { type: 'round1-keep', at: AT }).queue, 'skipped')
  assert.equal(apply(row, { type: 'round1-merge', approval: 'on', at: AT }).state, 'pending')
  assert.equal(apply(row, { type: 'round1-merge', approval: 'off', at: AT }).state, 'approved')
})

it('approve, round2 fail and success', () => {
  const pending = apply(candidate(), { type: 'round1-merge', approval: 'on', at: AT })
  const approved = apply(pending, { type: 'approve', runId: 'r1', at: AT })
  assert.equal(approved.state, 'approved')
  const failed = apply(approved, { type: 'round2-fail', failure, at: AT })
  assert.equal(failed.state, 'approved')
  assert.equal(failed.attempts, 1)
  assert.equal(apply(failed, { type: 'round2-success', at: AT }), null)
})

it('restore and invalid transition', () => {
  const skipped = apply(candidate(), { type: 'round1-keep', at: AT })
  assert.equal(apply(skipped, { type: 'restore', at: AT }).state, 'verify')
  const result = transitionRow(skipped, { type: 'approve', at: AT })
  assert.equal(result.ok, false)
})

it('expired markers and discard', () => {
  const pending = apply(candidate(), { type: 'round1-merge', approval: 'on', at: AT })
  const expired = apply(pending, { type: 'target-taken', at: AT })
  assert.equal(expired.expired, 'target-taken')
  assert.equal(expired.queue, 'pending')
  assert.equal(apply(pending, { type: 'discard', at: AT }), null)
})

it('staging expiry returns to approved; round2 cancel too', () => {
  const approved = apply(candidate(), { type: 'round1-merge', approval: 'off', at: AT })
  const fuse = apply(approved, { type: 'round2-start', at: AT })
  assert.equal(apply(fuse, { type: 'staging-expired', at: AT }).state, 'approved')
  assert.equal(apply(fuse, { type: 'round2-cancel', at: AT }).state, 'approved')
})
