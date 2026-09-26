import { describe, expect, it } from 'vitest'
import { computeQualityScores, computeDedupGroups, computePrefixClusters, normalizeUsageRecord, identity, affinity, vocabulary, projectionText, nearDuplicateSummaries, SUMMARY_DUPLICATE_HINT_THRESHOLD } from '@deepseek-ai/dsh-evolution-core'

function record(now: Date, overrides: Partial<{
  created_at: string
  use_count: number
  view_count: number
  patch_count: number
  last_used_at: string | null
}> = {}) {
  return {
    created_by: 'agent' as const,
    created_at: overrides.created_at ?? new Date(now.getTime() - 100 * 86_400_000).toISOString(),
    use_count: overrides.use_count ?? 0,
    view_count: overrides.view_count ?? 0,
    patch_count: overrides.patch_count ?? 0,
    last_used_at: overrides.last_used_at ?? null,
    last_viewed_at: null,
    last_patched_at: null,
    state: 'active' as const,
    pinned: false,
    archived_at: null,
  }
}

it('computes the six quality factors with weighted score', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const usage = new Map([['active-skill', record(now, {
    use_count: 30,
    patch_count: 10,
    last_used_at: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
  })]])
  const scores = computeQualityScores({ usage, supportDirs: new Map([['active-skill', 1]]), now })
  const score = scores.get('active-skill')
  expect(score).toBeDefined()
  expect(score!.factors.usageFrequency).toBeCloseTo(30 / 100, 5)
  expect(score!.factors.stability).toBeCloseTo(1 - 10 / 30, 5)
  expect(score!.factors.recency).toBe(1)
  expect(score!.factors.richness).toBeCloseTo(0.175, 5)
  expect(score!.warn).toBe(false)
})

it('E-2/G-1 (v18): view_count feeds the load factors (use_count is an external signal)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const usage = new Map([['loaded-skill', record(now, {
    view_count: 20,
    patch_count: 4,
    last_used_at: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
  })]])
  const score = computeQualityScores({ usage, now }).get('loaded-skill')!
  // 20 loads over 100 days — a real number, not the constant 0 the old
  // use_count-only formula produced for every production record.
  expect(score.factors.usageFrequency).toBeCloseTo(0.2, 5)
  expect(score.factors.stability).toBeCloseTo(1 - 4 / 20, 5)
})

it('flags a long-idle, never-used skill as low quality', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const usage = new Map([['zombie', record(now, {
    created_at: new Date(now.getTime() - 300 * 86_400_000).toISOString(),
    last_used_at: new Date(now.getTime() - 300 * 86_400_000).toISOString(),
  })]])
  const score = computeQualityScores({ usage, now }).get('zombie')!
  expect(score.factors.recency).toBe(0)
  expect(score.factors.usageFrequency).toBe(0)
  expect(score.factors.mutationMaturity).toBe(0.3)
  expect(score.score).toBeLessThan(0.3)
  expect(score.warn).toBe(true)
})

it('a garbage created_at normalizes to a finite score instead of NaN (N-3)', () => {
  // Normalization anchors the garbage created_at at the REAL now; use the
  // same instant for the quality computation so the record reads as fresh.
  const now = new Date()
  const dirty = {
    created_by: 'agent',
    created_at: 'not-a-date',
    use_count: 3,
    view_count: 0,
    patch_count: 1,
    last_used_at: 'not-a-date',
    last_viewed_at: null,
    last_patched_at: null,
    state: 'active',
    pinned: false,
    archived_at: null,
  }
  const normalized = normalizeUsageRecord(dirty)
  const score = computeQualityScores({ usage: new Map([['dirty-skill', normalized]]), now }).get('dirty-skill')!
  expect(Number.isFinite(Date.parse(normalized.created_at))).toBe(true)
  expect(Number.isFinite(score.score)).toBe(true)
  expect(score.warn).toBe(false)
  // Anchored at now: the record reads as brand new, so it is not low quality.
  expect(score.factors.recency).toBe(1)
})

it('dedup clusters exact copies and token-neighbors, skipping size-ratio outliers', () => {
  const contents = new Map<string, string>([
    ['a', 'Run tests with pytest -q.'],
    ['b', 'Run tests with pytest -q'],
    ['huge', `${'a '.repeat(200)}zzz`],
  ])
  const { groups } = computeDedupGroups({ contents })
  const cluster = groups.find(group => group.includes('a'))
  expect(cluster).toContain('b')
  expect(groups.some(group => group.includes('huge'))).toBe(false)
})

it('PLAN-R2 P2-8 (2026-09-16): a tiny pair budget truncates the scan, reports it, and keeps completed groups', () => {
  const contents = new Map<string, string>([
    ['a', 'Run tests with pytest -q.'],
    ['b', 'Run tests with pytest -q'],
    ['c', 'Deploy the service with docker compose up -d.'],
    ['d', 'Deploy the service with docker compose up -d'],
    ['e', 'Unrelated body about gardening tools and seasons'],
    ['f', 'Another unrelated body about kitchen remodels'],
    ['g', 'Identical shared body text here'],
    ['h', 'Identical shared body text here'],
  ])
  // Default budget: this library is far below it, so nothing truncates and
  // the grouping is exactly what the unbounded scan always produced.
  const full = computeDedupGroups({ contents })
  expect(full.truncated).toBe(false)
  expect(full.groups).toEqual([['a', 'b'], ['c', 'd'], ['g', 'h']])
  // Budget 2: only pairs (a,b) and (a,c) are compared before the scan stops.
  // (a,b) was compared in time and still clusters; (c,d) sits beyond the
  // budget and is never examined; the exact-hash pair (g,h) is pre-united
  // outside the budgeted loop, so it survives truncation.
  const capped = computeDedupGroups({ contents, maxPairComparisons: 2 })
  expect(capped.truncated).toBe(true)
  expect(capped.groups).toEqual([['a', 'b'], ['g', 'h']])
})

it('C: identity is the "same text?" question — case/whitespace-insensitive, projection-free', () => {
  expect(identity('Run  tests\nwith pytest')).toBe(identity('run tests with pytest'))
  expect(identity('a')).not.toBe(identity('b'))
  // It answers about WHATEVER text it is handed: the same question asked of a
  // body and of a name+description projection, no hidden normalization.
  expect(identity(projectionText('body', { content: 'x' }))).toBe(identity('x'))
})

it('C: affinity is the "shared vocabulary" question over two vocabulary sets', () => {
  expect(affinity(vocabulary('alpha beta gamma'), vocabulary('alpha beta gamma'))).toBe(1)
  expect(affinity(vocabulary('alpha beta'), vocabulary('gamma delta'))).toBe(0)
  // An empty side has no vocabulary to share — 0, never NaN.
  expect(affinity(vocabulary(''), vocabulary('alpha'))).toBe(0)
  expect(affinity(new Set<string>(), new Set<string>())).toBe(0)
  // 2 shared of 4 distinct tokens.
  expect(affinity(vocabulary('alpha beta'), vocabulary('alpha beta gamma delta'))).toBeCloseTo(0.5, 10)
})

it('C: a projection must be declared — body and summary are different texts', () => {
  expect(projectionText('body', { content: 'BODY', name: 'n', description: 'd' })).toBe('BODY')
  expect(projectionText('summary', { content: 'BODY', name: 'n', description: 'd' })).toBe('n d')
  // The summary projection is body-blind by construction: the same call with and
  // without a body is the same text.
  expect(projectionText('summary', { name: 'n', description: 'd' }))
    .toBe(projectionText('summary', { name: 'n', description: 'd', content: 'anything at all' }))
})

describe('C: the create-time near-duplicate question (summary projection)', () => {
  const existing = [
    { name: 'dsh-plugin-discovery', description: 'Search, filter and rank DSH plugins from the live catalog.' },
    { name: 'git-repo-sync', description: 'Safely update or synchronize a local git repository with its remote.' },
  ]

  it('names a near-copy and ranks the closest first', () => {
    const matches = nearDuplicateSummaries({
      candidate: { name: 'dsh-plugin-search', description: 'Search, filter and rank DSH plugins from the live catalog.' },
      existing,
    })
    expect(matches.map(match => match.name)).toEqual(['dsh-plugin-discovery'])
    expect(matches[0]!.score).toBeGreaterThanOrEqual(SUMMARY_DUPLICATE_HINT_THRESHOLD)
  })

  it('stays silent for an unrelated candidate, and for the candidate\'s own name', () => {
    // Unrelated: nothing above the level.
    expect(nearDuplicateSummaries({
      candidate: { name: 'windows-screen-capture', description: 'Take DPI-correct screenshots for the model.' },
      existing,
    })).toEqual([])
    // The same NAME is the library's own refusal, not this line's news.
    expect(nearDuplicateSummaries({
      candidate: { name: 'git-repo-sync', description: 'Safely update or synchronize a local git repository with its remote.' },
      existing,
    }).map(match => match.name)).toEqual([])
  })

  it('FALSIFIABLE: it cannot see bodies — a body-identical candidate with an unrelated summary does not fire', () => {
    // The projection IS the answer here: the body scan (`computeDedupGroups`) would
    // group these two, and this question must not — it is handed no body at all,
    // which is what keeps a create from paying a whole-tree body read to warn
    // about a copy.
    const body = 'Identical body text about tides and turbines and nothing else.'
    const scan = computeDedupGroups({ contents: new Map([['tides', body], ['turbines', body]]) })
    expect(scan.groups).toEqual([['tides', 'turbines']])
    expect(nearDuplicateSummaries({
      candidate: { name: 'turbines', description: 'An entirely different sentence about kitchen remodels.' },
      existing: [{ name: 'tides', description: 'A sentence about tides.' }],
    })).toEqual([])
  })
})
it('prefix clusters group by the first alphanumeric run, size-descending (rc.67 merge heuristic)', () => {
  const clusters = computePrefixClusters(['sql-backup', 'SQL-restore', 'sql-index', 'unrelated', '--dash-start'])
  expect(clusters).toEqual([
    { key: 'sql', members: ['sql-backup', 'SQL-restore', 'sql-index'] },
  ])
  expect(computePrefixClusters(['solo'])).toEqual([])
  expect(computePrefixClusters([])).toEqual([])
})

