import { expect, it } from 'vitest'
import { computeQualityScores, computeDedupGroups } from '@deepseek-ai/dsh-evolution-core'

function record(name: string, now: Date, overrides: Partial<{
  created_at: string
  use_count: number
  patch_count: number
  last_used_at: string | null
}> = {}) {
  return {
    created_by: 'agent' as const,
    created_at: overrides.created_at ?? new Date(now.getTime() - 100 * 86_400_000).toISOString(),
    use_count: overrides.use_count ?? 0,
    view_count: 0,
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
  const usage = new Map([['active-skill', record('active-skill', now, {
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

it('flags a long-idle, never-used skill as low quality', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const usage = new Map([['zombie', record('zombie', now, {
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

it('dedup clusters exact copies and token-neighbors, skipping size-ratio outliers', () => {
  const contents = new Map<string, string>([
    ['a', 'Run tests with pytest -q.'],
    ['b', 'Run tests with pytest -q'],
    ['huge', `${'a '.repeat(200)}zzz`],
  ])
  const groups = computeDedupGroups({ contents })
  const cluster = groups.find(group => group.includes('a'))
  expect(cluster).toContain('b')
  expect(groups.some(group => group.includes('huge'))).toBe(false)
})
