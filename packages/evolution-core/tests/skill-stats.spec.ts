// @tier fast
import { describe, expect, it } from 'vitest'
import {
  compareSkillStats,
  computeSkillStatsTotals,
  filterSkillStats,
  latestActivityAt,
  needsAttention,
  recentlyUsedAt,
  sortSkillStats,
  verdictRank,
  type SkillStatsRow,
} from '../src/skill-stats.ts'
import { SKILL_OPERATIONS } from '../src/skill-operations.ts'

function row(name: string, bodyChars: number | null, overrides: Partial<SkillStatsRow> = {}): SkillStatsRow {
  return {
    name,
    description: name + ' description',
    versions: 1,
    lastChangedAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: null,
    recentlyUsed: null,
    needsAttention: false,
    health: {
      verdict: 'healthy',
      bodyChars,
      bodyTokens: bodyChars,
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
    expect(totals.bodyTokens).toBeNull()
    expect(totals.supportFiles).toBe(2)
    expect(totals.skills).toBe(2)
    expect(totals.successes).toBeNull()
  })

  it('sums measured zeroes as zero and counts attention only for actionable verdicts', () => {
    const rows = [
      row('a', 0, { health: { ...row('a', 0).health!, verdict: 'warn' }, needsAttention: true }),
      row('b', 10, { health: { ...row('b', 10).health!, verdict: 'needs-restructure' }, needsAttention: true }),
      row('c', 5),
    ]
    const totals = computeSkillStatsTotals(rows, { offload: 1, condense: 0, extract: 2 })
    expect(totals.bodyChars).toBe(15)
    expect(totals.bodyTokens).toBe(15)
    expect(totals.needsAttention).toBe(2)
    expect(totals.successes).toEqual({ offload: 1, condense: 0, extract: 2 })
    expect(needsAttention(rows[2]!)).toBe(false)
  })
})

describe('skill stats filters', () => {
  it('attention keeps warn/needs-restructure rows only', () => {
    const rows = [
      row('a', 1, { health: { ...row('a', 1).health!, verdict: 'warn' }, needsAttention: true }),
      row('b', 1),
    ]
    expect(filterSkillStats(rows, 'attention').map(r => r.name)).toEqual(['a'])
    expect(filterSkillStats(rows, 'all')).toHaveLength(2)
  })

  it('recent uses the host-derived use window, not content-change time', () => {
    const rows = [
      row('changed-long-ago-viewed-yesterday', 1, { recentlyUsed: true }),
      row('changed-yesterday-never-used', 1, { recentlyUsed: false }),
      row('never-measured', 1, { recentlyUsed: null }),
    ]
    expect(filterSkillStats(rows, 'recent').map(r => r.name)).toEqual(['changed-long-ago-viewed-yesterday'])
  })

  it('derives activity from the newest load/use timestamp and the 30-day window', () => {
    const usage = {
      useCount: 0,
      viewCount: 0,
      viewCount30d: 0,
      patchCount: 0,
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      lastViewedAt: '2026-01-10T00:00:00.000Z',
      lastPatchedAt: null,
      state: 'active',
      pinned: false,
    }
    expect(latestActivityAt(usage)).toBe('2026-01-10T00:00:00.000Z')
    expect(recentlyUsedAt('2026-01-10T00:00:00.000Z', new Date('2026-01-20T00:00:00.000Z'))).toBe(true)
    expect(recentlyUsedAt('2026-01-01T00:00:00.000Z', new Date('2026-02-01T00:00:00.000Z'))).toBe(false)
    expect(recentlyUsedAt(null)).toBeNull()
  })
})

describe('skill operation presentation', () => {
  it('publishes one unique label key per counted operation', () => {
    expect(SKILL_OPERATIONS.map(operation => operation.id)).toEqual(['offload', 'condense', 'extract'])
    expect(new Set(SKILL_OPERATIONS.map(operation => operation.labelKey)).size).toBe(3)
    expect(SKILL_OPERATIONS.every(operation => operation.surface === 'advanced')).toBe(true)
  })
})
