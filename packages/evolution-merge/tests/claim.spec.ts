// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { acquireClaim, isClaimExpired, releaseClaim } from '../src/domain/claim.ts'

it('claim lease blocks live claim and expires', () => {
  const live = acquireClaim(undefined, 100, 10, 't1')
  assert.ok(live)
  assert.equal(acquireClaim(live, 105, 10, 't2'), undefined)
  assert.equal(acquireClaim(live, 110, 10, 't2')?.token, 't2')
  assert.equal(isClaimExpired(live, 110), true)
})

it('release only with token', () => {
  const claim = acquireClaim(undefined, 0, 100, 't1')
  assert.equal(releaseClaim(claim, 'bad'), claim)
  assert.equal(releaseClaim(claim, 't1'), undefined)
})
