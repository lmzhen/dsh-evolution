import { describe, expect, it } from 'vitest'
import { comparePlans, clampReplayWeights, Config, EvolutionReplayDriver } from '../src/index.ts'

describe('evolution-replay', () => {
  it('groups recorded plans by policy fingerprint instead of the random plan id', () => {
    const driver = new EvolutionReplayDriver()
    // rc.42 payload v2: record() takes the process-event payload directly
    // (the {type, data} session-event envelope is gone with A1).
    driver.record({ sessionId: 's1', planId: 'run-1', policyFingerprint: 'policy-a', memoryApplied: 1, skillApplied: 0, rejectedOps: 0, evidenceQuotes: 2, estimatedInputChars: 1500 })
    driver.record({ sessionId: 's1', planId: 'run-2', policyFingerprint: 'policy-a', memoryApplied: 1, skillApplied: 1, rejectedOps: 0 })
    driver.record({ sessionId: 's2', planId: 'run-3', memoryApplied: 0, skillApplied: 0, rejectedOps: 1 })
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

  it('clamps an invalid maxPlans to the default so the leaderboard still bounds (G3.1)', () => {
    const recordMany = (driver: EvolutionReplayDriver, count: number): void => {
      for (let i = 0; i < count; i += 1) {
        driver.record({ sessionId: 's', planId: `p-${i}`, policyFingerprint: `fp-${i}`, memoryApplied: 1, skillApplied: 0, rejectedOps: 0 })
      }
    }
    for (const bad of [0, -1, NaN, Infinity]) {
      const driver = new EvolutionReplayDriver({ maxPlans: bad })
      recordMany(driver, 60)
      expect(driver.plansSnapshot().length, `maxPlans=${String(bad)}`).toBe(50)
    }
    // A valid custom cap is preserved.
    const small = new EvolutionReplayDriver({ maxPlans: 5 })
    recordMany(small, 6)
    expect(small.plansSnapshot().length).toBe(5)
  })

  it('clamps replay weights to their per-field domains (G3.1 matrix)', () => {
    // Every invalid value falls back to that field's default.
    const clamped = clampReplayWeights({ accepted: 0, rejectedPenalty: -1, evidence: NaN, cost: Infinity })
    expect(clamped).toEqual({ accepted: 10, rejectedPenalty: 15, evidence: 2, cost: 0.001 })
    // cost = 0 is legal (no cost penalty), so it is retained.
    expect(clampReplayWeights({ cost: 0 }).cost).toBe(0)
    // Valid custom values are preserved per field.
    expect(clampReplayWeights({ accepted: 20, rejectedPenalty: 30, evidence: 3, cost: 0.01 }).rejectedPenalty).toBe(30)
    expect(clampReplayWeights({ accepted: 20, rejectedPenalty: 30, evidence: 3, cost: 0.01 }).accepted).toBe(20)
  })

  it('rejects 0/negative replay weights and maxPlans at the schema level (G3.1 .min())', () => {
    const parse = (input: unknown): unknown => (Config as unknown as (i: unknown) => unknown)(input)
    expect(() => parse({ maxPlans: 0 })).toThrow()
    expect(() => parse({ weights: { accepted: -1 } })).toThrow()
    expect(() => parse({ weights: { cost: -0.5 } })).toThrow()
  })
})
