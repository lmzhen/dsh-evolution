// @tier pre-tag
import { expect, it } from 'vitest'
import { MERGE_PARAM_DEFAULTS, resolveMergeParams } from '../src/index.ts'

it('defaults the five merge knobs', () => {
  const { limitsSnapshot, ...defaults } = resolveMergeParams()
  expect(defaults).toEqual(MERGE_PARAM_DEFAULTS)
  expect(limitsSnapshot?.limitsDigest).toMatch(/^[a-f0-9]{64}$/) 
  expect(MERGE_PARAM_DEFAULTS).toMatchObject({
    mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15, mergeModelsRoot: '',
  })
})

it('accepts overrides and rejects bad shapes loudly', () => {
  const { limitsSnapshot: _snapshot, ...overrides } = resolveMergeParams({
    mergeApproval: true, mergeSkippedTtlDays: 7, mergeRunTimeoutMinutes: 30, mergePairTimeoutMinutes: 5,
  })
  expect(overrides).toEqual({
    mergeApproval: true, mergeSkippedTtlDays: 7, mergeRunTimeoutMinutes: 30, mergePairTimeoutMinutes: 5, mergeModelsRoot: '', platformWrite: false,
  })
  expect(() => resolveMergeParams({ mergePairTimeoutMinutes: 0 })).toThrow('> 0')
  expect(() => resolveMergeParams({ mergeSkippedTtlDays: -1 })).toThrow('non-negative')
  expect(() => resolveMergeParams({ unknown: 1 })).toThrow('unknown')
  expect(() => resolveMergeParams({ mergeApproval: 1 })).toThrow('boolean')
  const { limitsSnapshot: _snap2, ...getterOverrides } = resolveMergeParams({
    mergeApproval: { get: () => true },
    mergeSkippedTtlDays: { get: () => 3 },
    mergeRunTimeoutMinutes: { get: () => 9 },
  })
  expect(getterOverrides).toEqual({ mergeApproval: true, mergeSkippedTtlDays: 3, mergeRunTimeoutMinutes: 9, mergePairTimeoutMinutes: 15, mergeModelsRoot: '', platformWrite: false })
})
