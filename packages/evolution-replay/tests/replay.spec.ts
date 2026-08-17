import { describe, expect, it } from 'vitest'
import { comparePlans, EvolutionReplayDriver } from '../src/index.ts'

describe('evolution-replay', () => {
  it('groups recorded plans by policy fingerprint instead of the random plan id', () => {
    const driver = new EvolutionReplayDriver()
    driver.record({
      type: 'evolution/plan-applied',
      data: { planId: 'run-1', policyFingerprint: 'policy-a', memoryApplied: 1, skillApplied: 0, rejectedOps: 0, evidenceQuotes: 2, estimatedInputChars: 1500 },
    })
    driver.record({
      type: 'evolution/plan-applied',
      data: { planId: 'run-2', policyFingerprint: 'policy-a', memoryApplied: 1, skillApplied: 1, rejectedOps: 0 },
    })
    driver.record({
      type: 'evolution/plan-applied',
      data: { planId: 'run-3', memoryApplied: 0, skillApplied: 0, rejectedOps: 1 },
    })
    const plans = driver.plansSnapshot()
    expect(plans.map(plan => plan.policyId)).toEqual(['policy-a', 'policy-a', 'run-3'])
    expect(plans[0]).toMatchObject({ evidenceQuotes: 2, estimatedInputChars: 1500 })
  })

  it('selects the plan with better accepted/evidence and lower cost', () => {
    const result = comparePlans([
      { policyId: 'A', acceptedOps: 3, rejectedOps: 1, memoryOps: 2, skillOps: 1, evidenceQuotes: 3, estimatedInputChars: 2000 },
      { policyId: 'B', acceptedOps: 4, rejectedOps: 0, memoryOps: 2, skillOps: 2, evidenceQuotes: 4, estimatedInputChars: 1800 },
    ])
    expect(result.winner).toBe('B')
    expect(result.margin).toBeGreaterThan(0)
  })
})
