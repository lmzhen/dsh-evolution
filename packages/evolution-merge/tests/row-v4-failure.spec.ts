// @tier pre-tag
import { expect, it } from 'vitest'
import { transitionV4, type V4Row } from '../src/domain/row-v4.ts'

const at = '2026-10-26T00:00:00.000Z'
const decision = { shouldMerge: true, mode: 'create-umbrella', target: 'merged', sources: ['a', 'b'], rationale: 'because' } as const
const failure = { stage: 'validate', code: 'merge-validation', message: 'invalid', retryable: false, retryFrom: 'none' } as const
const row: V4Row = { id: 'r1', pairKey: 'a\u0000b', a: 'a', b: 'b', version: 1, createdAt: at, updatedAt: at, origin: 'agent', attempts: 1, state: 'fuse', target: 'merged', decision }

it('keeps a non-retryable failure in fuse instead of writing skipped', () => {
  const moved = transitionV4(row, { type: 'failed', failure }, 1, at)
  expect(moved.ok).toBe(true)
  if (!moved.ok || moved.row === null) return
  expect(moved.row.state).toBe('fuse')
  expect(moved.row.failure).toMatchObject({ code: 'merge-validation', retryable: false })
})

it('still allows an explicit skipped decision to close the row', () => {
  const moved = transitionV4(row, { type: 'skipped', reason: 'agent keep', origin: 'agent' }, 1, at)
  expect(moved.ok).toBe(true)
  if (!moved.ok || moved.row === null) return
  expect(moved.row.state).toBe('skipped')
})
