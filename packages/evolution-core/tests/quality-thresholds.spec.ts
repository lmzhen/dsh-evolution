/**
 * S2-11 (the by-product of FLOW4-1): THRESHOLD REACHABILITY for the quality model.
 *
 * FLOW4-1 was refuted on the numbers (the audit's own arithmetic was wrong), but
 * the争论 was only decidable by hand. These rows make the model's boundaries
 * machine-checked instead: every expected value below is a LITERAL derived from
 * the documented formula, never recomputed from QUALITY_WEIGHTS — so retuning a
 * weight or changing a formula fails a specific row instead of silently moving
 * the boundary (the plan's acceptance is that this spec IS the evidence).
 *
 * The zero-load family (no loads, no patches, no references, no support dirs):
 *   score = stability 1*0.20 + mutationMaturity 0.3*0.20 + recency*0.20
 *         = 0.26 + 0.20*recency
 *   warn  <=> score < 0.30 <=> recency < 0.20 <=> idle > 30 + 0.8*150 = 150
 * so idle 150 is the LAST non-warn day (score exactly 0.30) and idle 151 the
 * first warn day. recency is the ONLY varying term there: that is what "recency
 * decides this boundary" means, and it is asserted factor by factor.
 */
import { expect, it } from 'vitest'
import { computeQualityScores } from '@deepseek-ai/dsh-evolution-core'

const DAY = 86_400_000
const NOW = new Date('2026-08-01T00:00:00.000Z')

function record(input: { ageDays: number; idleDays: number; loads?: number; patches?: number }) {
  return {
    created_by: 'agent' as const,
    created_at: new Date(NOW.getTime() - input.ageDays * DAY).toISOString(),
    use_count: 0,
    // Loads are LOADS (E-2/G-1): the in-tree producer bumps view_count.
    view_count: input.loads ?? 0,
    patch_count: input.patches ?? 0,
    last_used_at: new Date(NOW.getTime() - input.idleDays * DAY).toISOString(),
    last_viewed_at: null,
    last_patched_at: null,
    state: 'active' as const,
    pinned: false,
    archived_at: null,
  }
}

interface Case { ageDays: number; idleDays: number; loads?: number; patches?: number }

const scoreOf = (input: Case, extras: { references?: number; supportDirs?: number } = {}) =>
  computeQualityScores({
    usage: new Map([['subject', record(input)]]),
    referenceCounts: new Map([['subject', extras.references ?? 0]]),
    supportDirs: new Map([['subject', extras.supportDirs ?? 0]]),
    now: NOW,
  }).get('subject')!

it('S2-11: the recency-owned warn boundary in the zero-load family is exactly idle 150/151', () => {
  const rows: Array<{ idleDays: number; warn: boolean; score?: number }> = [
    { idleDays: 0, warn: false, score: 0.46 },
    { idleDays: 30, warn: false, score: 0.46 },
    { idleDays: 60, warn: false, score: 0.42 },
    { idleDays: 105, warn: false, score: 0.36 },
    { idleDays: 149, warn: false },
    { idleDays: 150, warn: false, score: 0.30 },
    { idleDays: 151, warn: true, score: 0.2986666666666667 },
    { idleDays: 180, warn: true, score: 0.26 },
    { idleDays: 300, warn: true, score: 0.26 },
  ]
  for (const row of rows) {
    const score = scoreOf({ ageDays: Math.max(300, row.idleDays), idleDays: row.idleDays })
    expect(score.warn, `idle=${row.idleDays}`).toBe(row.warn)
    if (row.score !== undefined) expect(score.score, `idle=${row.idleDays}`).toBeCloseTo(row.score, 10)
  }
})

it('S2-11: in that family recency is the only varying term (the dominance claim)', () => {
  for (const idleDays of [0, 30, 105, 180]) {
    const score = scoreOf({ ageDays: 300, idleDays })
    expect(score.factors.usageFrequency).toBe(0)
    expect(score.factors.stability).toBe(1)
    expect(score.factors.mutationMaturity).toBe(0.3)
    expect(score.factors.references).toBe(0)
    expect(score.factors.richness).toBe(0)
    const recency = idleDays < 30 ? 1 : Math.max(0, 1 - (idleDays - 30) / 150)
    expect(score.factors.recency).toBeCloseTo(recency, 10)
    expect(score.score).toBeCloseTo(0.26 + 0.20 * recency, 10)
  }
})

it('S2-11: sweeping idle days flips the warn flag exactly once, at 151', () => {
  const flips: number[] = []
  let previous: boolean | undefined
  for (let idleDays = 0; idleDays <= 250; idleDays += 1) {
    const warn = scoreOf({ ageDays: 300, idleDays }).warn
    if (previous !== undefined && warn !== previous) flips.push(idleDays)
    previous = warn
  }
  expect(flips).toEqual([151])
})

it('S2-11: every other factor reaches its documented endpoint', () => {
  // Usage frequency: loads per day, capped at 1; the age clock floors at 1 day.
  expect(scoreOf({ ageDays: 1, idleDays: 0, loads: 1 }).factors.usageFrequency).toBe(1)
  expect(scoreOf({ ageDays: 10, idleDays: 0, loads: 50 }).factors.usageFrequency).toBe(1)
  expect(scoreOf({ ageDays: 100, idleDays: 0, loads: 25 }).factors.usageFrequency).toBeCloseTo(0.25, 10)
  // Stability: 1 - patch/load, and zero loads is defined STABLE.
  expect(scoreOf({ ageDays: 100, idleDays: 0, loads: 10, patches: 10 }).factors.stability).toBe(0)
  expect(scoreOf({ ageDays: 100, idleDays: 0, loads: 0, patches: 5 }).factors.stability).toBe(1)
  // Mutation maturity ladder (DSH approximation): 0 -> 0.3, 1 -> 0.4, n -> min(1, (n-1)/(age/30)).
  expect(scoreOf({ ageDays: 300, idleDays: 0, patches: 0 }).factors.mutationMaturity).toBe(0.3)
  expect(scoreOf({ ageDays: 300, idleDays: 0, patches: 1 }).factors.mutationMaturity).toBe(0.4)
  expect(scoreOf({ ageDays: 300, idleDays: 0, patches: 2 }).factors.mutationMaturity).toBeCloseTo(0.1, 10)
  expect(scoreOf({ ageDays: 300, idleDays: 0, patches: 12 }).factors.mutationMaturity).toBe(1)
  // References: in-degree / 3, capped.
  expect(scoreOf({ ageDays: 100, idleDays: 0 }, { references: 1 }).factors.references).toBeCloseTo(1 / 3, 10)
  expect(scoreOf({ ageDays: 100, idleDays: 0 }, { references: 3 }).factors.references).toBe(1)
  // Richness: support dirs * 0.175, capped.
  expect(scoreOf({ ageDays: 100, idleDays: 0 }, { supportDirs: 1 }).factors.richness).toBeCloseTo(0.175, 10)
  expect(scoreOf({ ageDays: 100, idleDays: 0 }, { supportDirs: 6 }).factors.richness).toBe(1)
})

it('S2-11: the two ends of the range — a healthy skill clears the bar, a low-load fossil does not', () => {
  const healthy = scoreOf({ ageDays: 100, idleDays: 5, loads: 30, patches: 10 }, { references: 3, supportDirs: 2 })
  expect(healthy.factors.usageFrequency).toBeCloseTo(0.3, 10)
  expect(healthy.score).toBeCloseTo(0.7258333333333333, 10)
  expect(healthy.warn).toBe(false)
  // One load in 400 days and idle for 200: not zero-load, still a fossil.
  const fossil = scoreOf({ ageDays: 400, idleDays: 200, loads: 1, patches: 0 })
  expect(fossil.score).toBeCloseTo(0.260625, 10)
  expect(fossil.warn).toBe(true)
})
