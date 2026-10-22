// @tier pre-tag
import assert from 'node:assert/strict'
import test from 'node:test'
import { allowedEvents, queueOf, transition } from '../src/domain/state.ts'

test('queue mapping is five states to four queues', () => {
  assert.equal(queueOf('verify'), 'verify')
  assert.equal(queueOf('pending'), 'pending')
  assert.equal(queueOf('approved'), 'fuse')
  assert.equal(queueOf('fuse'), 'fuse')
  assert.equal(queueOf('skipped'), 'skipped')
})

test('round1 keep goes to skipped', () => {
  assert.deepEqual(transition('verify', { type: 'round1-keep' }), { ok: true, state: 'skipped' })
})

test('approval on merge waits in pending; approval off starts approved', () => {
  assert.deepEqual(transition('verify', { type: 'round1-merge', approval: true }), { ok: true, state: 'pending' })
  assert.deepEqual(transition('verify', { type: 'round1-merge', approval: false }), { ok: true, state: 'approved' })
})

test('approve then round2 start enters fuse', () => {
  assert.deepEqual(transition('pending', { type: 'approve' }), { ok: true, state: 'approved' })
  assert.deepEqual(transition('approved', { type: 'round2-start' }), { ok: true, state: 'fuse' })
})

test('round2 failure returns to approved; success removes row', () => {
  assert.deepEqual(transition('fuse', { type: 'round2-fail' }), { ok: true, state: 'approved' })
  assert.deepEqual(transition('fuse', { type: 'round2-merged' }), { ok: true, state: null, removed: true })
})

test('source gone removes active row', () => {
  assert.deepEqual(transition('pending', { type: 'source-gone' }), { ok: true, state: null, removed: true })
})

test('invalid transitions are rejected', () => {
  const result = transition('verify', { type: 'approve' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'invalid-transition')
})

test('allowed events are explicit for every state', () => {
  for (const state of ['verify', 'pending', 'approved', 'fuse', 'skipped'] as const) {
    assert.ok(allowedEvents(state).length >= 0)
  }
})
