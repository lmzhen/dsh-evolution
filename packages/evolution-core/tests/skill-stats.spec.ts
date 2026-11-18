// @tier fast
import { describe, expect, it } from 'vitest'
import {
  compareSkillStats,
  computeSkillStatsTotals,
  filterSkillStats,
  needsAttention,
  sortSkillStats,
  verdictRank,
  type SkillStatsRow,
} from '../src/skill-stats.ts'

function row(name: string, bodyChars: number | null, overrides: Partial<SkillStatsRow> = {}): SkillStatsRow {
  return {
    name,
    description: name + ' description',
    versions: 1,
    lastAt: '2026-01-01T00:00:00.000Z',
    health: {
      verdict: 'healthy',
      bodyChars,
      bodyTokens: null,
      supportFiles: 1,
      stampDensityPerKb: null,
      churnPatches: null,
      churnReads: null,
      hardCapHits: null,
      findings: 0,
    },
    usage: null,
    feedback: null,
    feedback30d: null,
    negativeFeedback30d: null,
    feedbackRate30d: null,
    errorNotes: null,
    ...overrides,
  }
}

describe('skill stats sorting', () => {
  it('sorts numeric columns descending and keeps nulls last in both directions', () => {
    const rows = [row('a', 10), row('b', null), row('c', 30)]
    expect(sortSkillStats(rows, 'bodyChars', 'desc').map(r => r.name)).toEqual(['c', 'a', 'b'])
    expect(sortSkillStats(rows, 'bodyChars', 'asc').map(r => r.name)).toEqual(['a', 'c', 'b'])
  })

  it('uses a stable name tie-break instead of input order', () => {
    const rows = [row('z', 10), row('a', 10), row('m', 10)]
    expect(sortSkillStats(rows, 'bodyChars', 'desc').map(r => r.name)).toEqual(['a', 'm', 'z'])
  })

  it('sorts unhealthy verdicts before healthy ones', () => {
    const rows = [
      row('healthy', 1, { health: { ...row('x', 1).health!, verdict: 'healthy' } }),
      row('needs', 1, { health: { ...row('x', 1).health!, verdict: 'needs-restructure' } }),
      row('unknown', 1, { health: { ...row('x', 1).health!, verdict: 'unknown' } }),
    ]
    expect(sortSkillStats(rows, 'verdict', 'asc').map(r => r.name)).toEqual(['needs', 'unknown', 'healthy'])
    expect(verdictRank('warn')).toBe(1)
  })

  it('sort value is null when a dimension was not measured', () => {
    expect(compareSkillStats(row('a', null), row('b', 0), 'bodyChars', 'asc')).toBeGreaterThan(0)
  })
})

describe('skill stats totals', () => {
  it('keeps an unmeasured total null and does not turn missing rows into zero', () => {
    const totals = computeSkillStatsTotals([row('a', null), row('b', null)], null)
    expect(totals.bodyChars).toBeNull()
    expect(totals.supportFiles).toBe(2)
    expect(totals.skills).toBe(2)
    expect(totals.successes).toBeNull()
  })

  it('sums measured zeroes as zero and counts attention only for actionable verdicts', () => {
    const rows = [
      row('a', 0, { health: { ...row('a', 0).health!, verdict: 'warn' } }),
      row('b', 10, { health: { ...row('b', 10).health!, verdict: 'needs-restructure' } }),
      row('c', 5),
    ]
    const totals = computeSkillStatsTotals(rows, { offload: 1, condense: 0, extract: 2 })
    expect(totals.bodyChars).toBe(15)
    expect(totals.needsAttention).toBe(2)
    expect(totals.successes).toEqual({ offload: 1, condense: 0, extract: 2 })
    expect(needsAttention(rows[2]!)).toBe(false)
  })
})

describe('skill stats filters', () => {
  it('attention keeps warn/needs-restructure rows only', () => {
    const rows = [
      row('a', 1, { health: { ...row('a', 1).health!, verdict: 'warn' } }),
      row('b', 1),
    ]
    expect(filterSkillStats(rows, 'attention').map(r => r.name)).toEqual(['a'])
    expect(filterSkillStats(rows, 'all')).toHaveLength(2)
  })
})



