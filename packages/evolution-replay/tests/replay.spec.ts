import { describe, expect, it } from 'vitest'
import { comparePlans, clampReplayWeights, Config, DEFAULT_WEIGHTS, EvolutionReplayDriver } from '../src/index.ts'

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

  it('V25-01: backfill is once-per-driver — an io reload re-running the loader must not double the leaderboard', () => {
    const driver = new EvolutionReplayDriver()
    const item = { sessionId: 's1', planId: 'run-1', policyFingerprint: 'policy-a', memoryApplied: 1, skillApplied: 0, rejectedOps: 0, at: 1 }
    // First io mount backfills; a later io dependency replacement re-runs the
    // loader against the SAME driver — the guard must swallow the replay.
    driver.backfill([item])
    driver.backfill([item, item])
    expect(driver.plansSnapshot()).toHaveLength(1)
    // Live events recorded after the backfill still land normally.
    driver.record({ sessionId: 's2', planId: 'run-2', memoryApplied: 1, skillApplied: 0, rejectedOps: 0 })
    expect(driver.plansSnapshot()).toHaveLength(2)
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

  it('clamps replay weights to their per-field domains (G3.1 matrix)', () => {    // Every invalid value falls back to that field's default.
    const clamped = clampReplayWeights({ accepted: 0, rejectedPenalty: -1, evidence: NaN, cost: Infinity })
    expect(clamped).toEqual({ accepted: 10, rejectedPenalty: 15, evidence: 2, cost: 0.001 })
    // cost = 0 is legal (no cost penalty), so it is retained.
    expect(clampReplayWeights({ ...DEFAULT_WEIGHTS, cost: 0 }).cost).toBe(0)
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

  it('V4-40: warns once when weights must be clamped, and stays silent for valid values', () => {
    const warns: string[] = []
    new EvolutionReplayDriver(
      { weights: { accepted: 0, rejectedPenalty: -1, evidence: NaN, cost: Infinity } },
      message => warns.push(message),
    )
    expect(warns.some(message => message.includes('weights') && message.includes('falling back'))).toBe(true)
    // A fully valid custom weights object never warns.
    const silent: string[] = []
    new EvolutionReplayDriver(
      { weights: { accepted: 20, rejectedPenalty: 30, evidence: 3, cost: 0.01 } },
      message => silent.push(message),
    )
    expect(silent).toEqual([])
    // cost = 0 is legal ("no cost penalty"), so it is not flagged.
    const costWarns: string[] = []
    new EvolutionReplayDriver({ weights: { ...DEFAULT_WEIGHTS, cost: 0 } }, message => costWarns.push(message))
    expect(costWarns).toEqual([])
  })

  it('V6-10: records and surfaces the execution-failure dimension (0.3.36)', () => {
    const driver = new EvolutionReplayDriver()
    driver.record({ sessionId: 's1', planId: 'run-1', policyFingerprint: 'policy-a', memoryApplied: 0, skillApplied: 0, rejectedOps: 0, executionFailures: 3, executionError: 'staged (approval)' })
    const plans = driver.plansSnapshot()
    expect(plans[0]?.executionFailures).toBe(3)
    expect(plans[0]?.executionError).toBe('staged (approval)')
    // The leaderboard surface shows the failure dimension — a plan whose ops
    // all failed must not read as a clean "0/0" plan.
    const result = driver.compare()
    expect(result.report).toContain('3 failed: staged (approval)')
  })

  it('P3-23 (v14): a malformed op counter cannot poison the score with NaN', () => {
    const driver = new EvolutionReplayDriver()
    // A persisted event with missing/non-numeric counters (the boundary the
    // record() fields arrive from) must degrade to 0, not NaN.
    driver.record({ sessionId: 's1', planId: 'run-1', policyFingerprint: 'p', memoryApplied: 'two', skillApplied: undefined, rejectedOps: NaN } as unknown as Parameters<typeof driver.record>[0])
    const plan = driver.plansSnapshot()[0]!
    expect(plan.acceptedOps).toBe(0)
    expect(plan.rejectedOps).toBe(0)
    expect(Number.isNaN(plan.acceptedOps)).toBe(false)
  })

  it('P2-2 (v15): NaN evidenceQuotes cannot poison the scored dimension; negatives are counters', () => {
    const driver = new EvolutionReplayDriver()
    // The v14 fix covered only 3/6 numeric fields — `typeof NaN === 'number'`
    // let evidenceQuotes straight into scorePlan (evidence IS scored) and the
    // comparator degenerated (`b.score - a.score` -> NaN).
    driver.record({ sessionId: 's1', planId: 'run-1', policyFingerprint: 'p', memoryApplied: 2, skillApplied: 1, rejectedOps: 0, evidenceQuotes: NaN, estimatedInputChars: Infinity, executionFailures: NaN })
    const plan = driver.plansSnapshot()[0]!
    expect(plan.evidenceQuotes).toBe(3) // missing/malformed keeps the applied-ops heuristic
    expect(plan.estimatedInputChars).toBe(0)
    expect(plan.executionFailures).toBe(0)
    const result = driver.compare()
    // Winner selection used to be implementation-defined (NaN comparator);
    // with finite scores the policy id resolves deterministically.
    expect(result.winner).toBe('p')
    expect(Number.isNaN(result.margin)).toBe(false)
    // Negative counters read as malformed (a counter cannot be negative).
    const driver2 = new EvolutionReplayDriver()
    driver2.record({ sessionId: 's', planId: 'r', policyFingerprint: 'p', memoryApplied: -5, skillApplied: 1, rejectedOps: 0 })
    expect(driver2.plansSnapshot()[0]?.acceptedOps).toBe(1)
    expect(driver2.plansSnapshot()[0]?.memoryOps).toBe(0)
  })

  it('V27 INS-05: the pre-backfill dedupe window is bounded (FIFO) and still dedupes the newest ids', () => {
    // `preBackfillIds` was cleared only inside backfill(), so a sidecar load that
    // never succeeded let every live plan id accumulate for the process
    // lifetime. Past the cap the OLDEST ids drop out: the window is finite, and
    // the newest ids — the ones a still-pending read window can replay — stay
    // deduped. Both directions are observable at the leaderboard.
    const cap = 4096
    const driver = new EvolutionReplayDriver({ maxPlans: cap + 10 })
    const plan = (id: string) => ({ sessionId: 's', planId: id, policyFingerprint: id, memoryApplied: 1, skillApplied: 0, rejectedOps: 0 })
    for (let index = 0; index < cap + 1; index += 1) driver.record(plan(`pre-${index}`))
    expect(driver.plansSnapshot()).toHaveLength(cap + 1)
    // The oldest id fell out of the tracking set → the sidecar copy is recorded
    // again; the newest is still tracked → it is dropped as a duplicate.
    driver.backfill([
      { ...plan('pre-0'), at: 1 },
      { ...plan(`pre-${cap}`), at: 2 },
    ])
    const ids = driver.plansSnapshot().map(entry => entry.policyId)
    expect(ids.filter(id => id === 'pre-0')).toHaveLength(2)
    expect(ids.filter(id => id === `pre-${cap}`)).toHaveLength(1)
    // The latch is one-shot: a second backfill never re-adds anything.
    driver.backfill([{ ...plan('pre-1'), at: 3 }])
    expect(driver.plansSnapshot().filter(entry => entry.policyId === 'pre-1')).toHaveLength(1)
  })
})

it('v28 G4.4 (RPL-01): a single plan yields margin null and an explicit no-comparison note', () => {
  const result = comparePlans([
    { policyId: 'only', acceptedOps: 3, rejectedOps: 0, memoryOps: 1, skillOps: 1, evidenceQuotes: 2, estimatedInputChars: 1000 },
  ])
  expect(result.winner).toBe('only')
  expect(result.margin).toBeNull()
  expect(result.report).toContain('single plan recorded')
  // No plans at all: same null margin discipline.
  expect(comparePlans([]).margin).toBeNull()
})

it('v29 RPL-02: backfilled (older) sidecar plans land at the chronological head, so maxPlans evicts the oldest', () => {
  const driver = new EvolutionReplayDriver({ maxPlans: 3 })
  // A live plan lands between listener registration and the async backfill.
  driver.record({ sessionId: 's', planId: 'live-1', memoryApplied: 1, skillApplied: 0, rejectedOps: 0 })
  // The sidecar backfill brings OLDER plans (sidecar order: oldest first).
  driver.backfill([
    { sessionId: 's', planId: 'old-1', at: 1, memoryApplied: 1, skillApplied: 0, rejectedOps: 0 },
    { sessionId: 's', planId: 'old-2', at: 2, memoryApplied: 1, skillApplied: 0, rejectedOps: 0 },
  ])
  // One more live plan: the FIFO must now evict the OLDEST record (old-1),
  // not the freshest live plan (the pre-fix order shifted out live-1).
  driver.record({ sessionId: 's', planId: 'live-2', memoryApplied: 2, skillApplied: 0, rejectedOps: 0 })
  const ids = driver.plansSnapshot().map(plan => plan.policyId)
  expect(ids).toEqual(['old-2', 'live-1', 'live-2'])
})
