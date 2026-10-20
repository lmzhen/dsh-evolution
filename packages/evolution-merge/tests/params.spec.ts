// @tier pre-tag
import { expect, it } from 'vitest'
import { MERGE_PARAM_DEFAULTS, resolveMergeParams } from '../src/index.ts'

it('defaults the four merge knobs', () => {
  expect(resolveMergeParams()).toEqual(MERGE_PARAM_DEFAULTS)
  expect(MERGE_PARAM_DEFAULTS).toMatchObject({ mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 })
})

it('accepts overrides and rejects bad shapes loudly', () => {
  expect(resolveMergeParams({ mergeApproval: true, mergeSkippedTtlDays: 7, mergeRunTimeoutMinutes: 30, mergePairTimeoutMinutes: 5 })).toEqual({
    mergeApproval: true, mergeSkippedTtlDays: 7, mergeRunTimeoutMinutes: 30, mergePairTimeoutMinutes: 5,
  })
  expect(() => resolveMergeParams({ mergePairTimeoutMinutes: 0 })).toThrow('> 0')
  expect(() => resolveMergeParams({ mergeSkippedTtlDays: -1 })).toThrow('non-negative')
  expect(() => resolveMergeParams({ unknown: 1 })).toThrow('unknown')
  expect(() => resolveMergeParams({ mergeApproval: 1 })).toThrow('boolean')
  expect(resolveMergeParams({
    mergeApproval: { get: () => true },
    mergeSkippedTtlDays: { get: () => 3 },
    mergeRunTimeoutMinutes: { get: () => 9 },
  })).toEqual({ mergeApproval: true, mergeSkippedTtlDays: 3, mergeRunTimeoutMinutes: 9, mergePairTimeoutMinutes: 15 })
})
