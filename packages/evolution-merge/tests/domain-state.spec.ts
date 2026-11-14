// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { queueOf } from '../src/domain/state.ts'

it('queue mapping is five states to four queues', () => {
  assert.equal(queueOf('verify'), 'verify')
  assert.equal(queueOf('pending'), 'pending')
  assert.equal(queueOf('approved'), 'fuse')
  assert.equal(queueOf('fuse'), 'fuse')
  assert.equal(queueOf('skipped'), 'skipped')
})
