// @tier pre-tag
import { expect, it } from 'vitest'
import { transitionV3, type V3Row } from '../src/domain/row-v3.ts'

const base = { id: 'r', pairKey: 'a|b', a: 'a', b: 'b', version: 0, createdAt: 'x', updatedAt: 'x', origin: 'agent' as const }
const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'same' }
const failure = { stage: 'commit' as const, code: 'commit-failed', message: 'x', retryable: true, retryFrom: 'agent2' as const }

function row(state: V3Row['state']): V3Row {
  if (state === 'verify') return { ...base, state, verifySubState: 'candidate', attempts: 0 }
  if (state === 'pending') return { ...base, state, target: 'a', decision, attempts: 0 }
  if (state === 'approved') return { ...base, state, target: 'a', decision, attempts: 0 }
  if (state === 'fuse') return { ...base, state, target: 'a', decision, attempts: 0, staging: { kind: 'present', ref: 's', expiresAt: 10 } }
  return { ...base, state, reason: 'r', attempts: 0 }
}

it('runs the legal state/event matrix', () => {
  expect(transitionV3(row('verify'), { type: 'verify-passed', decision, target: 'a' }, 0).ok).toBe(true)
  expect(transitionV3(row('pending'), { type: 'approved', runId: 'u' }, 0).ok).toBe(true)
  expect(transitionV3(row('approved'), { type: 'committed', unitId: 'u' }, 0)).toMatchObject({ ok: true, row: null })
  expect(transitionV3(row('fuse'), { type: 'failed', failure }, 0)).toMatchObject({ ok: true, row: { state: 'pending', attempts: 1 } })
  expect(transitionV3(row('skipped'), { type: 'committed', unitId: 'u' }, 0)).toMatchObject({ ok: false, code: 'illegal-transition' })
})

it('rejects stale versions and illegal edges', () => {
  expect(transitionV3(row('verify'), { type: 'approved', runId: 'u' }, 1)).toMatchObject({ ok: false, code: 'version-conflict' })
  expect(transitionV3(row('verify'), { type: 'committed', unitId: 'u' }, 0)).toMatchObject({ ok: false, code: 'illegal-transition' })
})
