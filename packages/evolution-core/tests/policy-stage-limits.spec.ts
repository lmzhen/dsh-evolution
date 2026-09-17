/**
 * 0.5.0 (design §16.7): ONE conversion from the deployment policy snapshot to
 * library limits. Only present fields are copied — pinning `undefined` onto an
 * optional limit would defeat the store's `?? DEFAULT` resolution (and
 * exactOptionalPropertyTypes forbids it).
 */
import { describe, expect, it } from 'vitest'
import { POLICY_STAGE_DEFAULTS, policyStageLimits } from '@deepseek-ai/dsh-evolution-core'

describe('policyStageLimits', () => {
  it('returns nothing for an unmounted policy', () => {
    expect(policyStageLimits(undefined)).toEqual({})
  })

  it('copies exactly the stages the snapshot carries', () => {
    expect(policyStageLimits({ supportFileCharPolicy: 'enforce' })).toEqual({ supportFileCharPolicy: 'enforce' })
    expect(policyStageLimits({ ...POLICY_STAGE_DEFAULTS, referenceRewrite: 'apply' })).toEqual({
      citationPolicy: POLICY_STAGE_DEFAULTS.citationPolicy,
      referenceRewrite: 'apply',
      archiveRetention: POLICY_STAGE_DEFAULTS.archiveRetention,
      supportFileCharPolicy: POLICY_STAGE_DEFAULTS.supportFileCharPolicy,
    })
  })

  it('never emits an undefined VALUE for an absent field', () => {
    const partial = policyStageLimits({ archiveRetention: 'prune' })
    expect(Object.keys(partial)).toEqual(['archiveRetention'])
    expect('citationPolicy' in partial).toBe(false)
  })
})
