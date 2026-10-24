// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { transition } from '../src/coordinator.ts'

const AT = '2026-10-20T00:00:00.000Z'
const failure = { stage: 'author' as const, code: 'E', message: 'boom', retryable: true, retryFrom: 'agent2' as const }

function row() {
  const result = transition(undefined, { type: 'candidate', a: 'a', b: 'b', at: AT })
  if (!result.ok || result.row === null) throw new Error('candidate failed')
  return result.row
}

function apply(rowValue: ReturnType<typeof row>, event: Parameters<typeof transition>[1]) {
  const result = transition(rowValue, event)
  if (!result.ok) throw new Error(result.message)
  return result.row
}

it('candidate uses new verify queue', () => {
  assert.equal(row().state, 'verify')
  assert.equal(row().queue, 'verify')
})

it('approval off enters approved; approve enters approved', () => {
  const off = apply(row(), { type: 'round1-merge', approval: 'off', at: AT })
  assert.equal(off.state, 'approved')
  assert.equal(off.queue, 'fuse')
  const pending = apply(row(), { type: 'round1-merge', approval: 'on', at: AT })
  assert.equal(apply(pending, { type: 'approve', at: AT }).state, 'approved')
})

it('round2 fail returns approved and success drops', () => {
  const approved = apply(row(), { type: 'round1-merge', approval: 'off', at: AT })
  const failed = apply(approved, { type: 'round2-fail', failure, at: AT })
  assert.equal(failed.state, 'approved')
  assert.equal(failed.attempts, 1)
  assert.equal(apply(failed, { type: 'round2-success', at: AT }), null)
})

it('restore skipped row to verify', () => {
  const skipped = apply(row(), { type: 'round1-keep', at: AT })
  assert.equal(apply(skipped, { type: 'restore', at: AT }).state, 'verify')
})
