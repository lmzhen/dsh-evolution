// @tier pre-tag
import { expect, it } from 'vitest'
import type { V4Row } from '../src/domain/row-v4.ts'
import { toRowFact } from '../src/surface/merge-view.ts'

it('carries the skipped reason code to the wire row', () => {
  const row: V4Row = { id: 'r1', pairKey: 'a\u0000b', a: 'a', b: 'b', version: 1, createdAt: 'x', updatedAt: 'x', origin: 'system', state: 'skipped', reason: 'merge-over-limit', attempts: 0 }
  const fact = toRowFact({ row, stage: null, bodies: [], queue: 'skipped', expired: false })
  expect(fact.reasonCode).toBe('merge-over-limit')
  expect(fact.reason).toBe('merge-over-limit')
})

it('gives a verify row the candidates --retry action, not a fresh pair', () => {
  const row: V4Row = { id: 'v1', pairKey: 'a\u0000b', a: 'a', b: 'b', version: 1, createdAt: 'x', updatedAt: 'x', origin: 'agent', state: 'verify', verifySubState: 'unverified', attempts: 0 }
  const fact = toRowFact({ row, stage: null, bodies: [], queue: 'verify', expired: false })
  expect(fact.actions.map(action => action.id)).toEqual(['retry-candidates'])
  expect(fact.actions[0]?.command).toBe('/evolution merge candidates --retry v1')
})

it('gives a non-retryable stale fuse row pair/discard, not resume', () => {
  const row: V4Row = { id: 'f1', pairKey: 'a\u0000b', a: 'a', b: 'b', version: 1, createdAt: 'x', updatedAt: 'x', origin: 'agent', state: 'fuse', target: 'a', decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['a', 'b'], rationale: 'r' }, attempts: 1, failure: { stage: 'author', code: 'source-changed', message: 'source moved', retryable: false, retryFrom: 'none' } }
  const fact = toRowFact({ row, stage: null, bodies: [], queue: 'fuse', expired: false })
  expect(fact.actions.map(action => action.id)).toEqual(['pair', 'discard'])
})
