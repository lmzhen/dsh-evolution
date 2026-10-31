import { describe, expect, it } from 'vitest'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { SKILL_SEARCH_TOKENIZER_VERSION, SkillSearchCache, SkillSearchIndex, searchTerms, skillIndexRowOf, skillKeyOf } from '../src/index.ts'

function summary(name: string, modelInvocable = true): SkillSummary {
  return { name, description: name + ' description', whenToUse: 'use ' + name, invocation: { modelInvocable, userInvocable: true }, source: 'user-dsh', provider: 'dsh-evolution' }
}
function rows(names: string[]) {
  return names.map(name => skillIndexRowOf(summary(name), false))
}

describe('searchTerms parity', () => {
  it('matches the platform CJK bigram + tail and ASCII run rules', () => {
    expect(SKILL_SEARCH_TOKENIZER_VERSION).toBe('cjk-bigram-v1')
    expect(searchTerms('能力测试')).toEqual(['能力', '力测', '测试', '试'])
    expect(searchTerms('DeepSeek 技能')).toEqual(['DeepSeek', '技能', '能'])
    expect(searchTerms('ＡＢＣ')).toEqual(['ABC'])
    expect(searchTerms('ガイド')).toEqual(['ガイ', 'イド', 'ド'])
    expect(searchTerms('中')).toEqual(['中'])
    expect(searchTerms('Alpha_Beta123')).toEqual(['Alpha', 'Beta123'])
  })
})

describe('SkillSearchIndex', () => {
  it('indexes all modelInvocable rows including hidden/unclassified and excludes non-invocable', async () => {
    const all = rows(['alpha', 'hidden-skill', 'unclassified', 'manual-only'])
    all[3] = { ...all[3]!, modelInvocable: false }
    const index = SkillSearchIndex.fromRows('v', all)
    expect((await index.search({ query: 'hidden-skill' })).results.map(hit => hit.name)).toContain('hidden-skill')
    expect((await index.search({ query: 'unclassified' })).results.map(hit => hit.name)).toContain('unclassified')
    expect((await index.search({ query: 'manual-only' })).results).toHaveLength(0)
  })

  it('does not index protected or pinned skills', async () => {
    const pinnedRow = skillIndexRowOf(summary('pinned-skill'), true, false, true)
    const pinnedIndex = SkillSearchIndex.fromRows('v', [pinnedRow])
    expect((await pinnedIndex.search({ query: 'pinned-skill' })).results).toHaveLength(0)
    const protectedRow = skillIndexRowOf(summary('protected-skill'), true, true)
    const index = SkillSearchIndex.fromRows('v', [protectedRow])
    expect((await index.search({ query: 'protected-skill' })).results).toHaveLength(0)
  })

  it('keeps views isolated, caps limit, and marks stale after rebuild starts', async () => {
    const left = SkillSearchIndex.fromRows('left', rows(['alpha']))
    const right = SkillSearchIndex.fromRows('right', rows(['beta']))
    expect((await left.search({ query: 'beta' })).results).toHaveLength(0)
    expect((await right.search({ query: 'beta' })).results[0]?.name).toBe('beta')
    expect((await left.search({ query: 'alpha', limit: 0 })).results).toHaveLength(1)
    expect((await left.search({ query: 'alpha' }, { allowedSkillKeys: new Set() })).results).toHaveLength(0)
    left.markStale()
    expect((await left.search({ query: 'alpha' })).stale).toBe(true)
    await left.rebuild(rows(['gamma']))
    expect((await left.search({ query: 'gamma' })).stale).toBe(false)
  })

  it('does one OR fallback only on zero AND hits and never returns score/body/nextK', async () => {
    const index = SkillSearchIndex.fromRows('v', rows(['alpha-beta']))
    const fallback = await index.search({ query: 'alpha gamma' })
    expect(fallback.fallback).toBe(true)
    expect(fallback.results[0]?.name).toBe('alpha-beta')
    expect(fallback.results[0]).not.toHaveProperty('score')
    expect(fallback.results[0]).not.toHaveProperty('content')
    expect(fallback).not.toHaveProperty('nextK')
    const exact = await index.search({ query: 'alpha' })
    expect(exact.fallback).toBeUndefined()
    expect(exact.results[0]?.matchedBy).toBe('name')
  })

  it('keys per-view cache by searchIndexKey and invalidates one view', async () => {
    const cache = new SkillSearchCache()
    const key = { viewKey: 'v', viewCatalogDigest: 'c1', policyDigest: 'p1', discoveryMode: 'on' }
    const first = await cache.get(key, rows(['alpha']))
    expect(first?.stale).toBe(false)
    const second = await cache.get(key, rows(['beta']))
    expect(second?.index).toBe(first?.index)
    cache.invalidate('v')
    const fresh = await cache.get(key, rows(['gamma']))
    expect(fresh?.index).not.toBe(first?.index)
  })
})


it('filters search hits through allowedSkillKeys for disabled/policy views', async () => {
  const index = SkillSearchIndex.fromRows('v', [skillIndexRowOf(summary('alpha'), true), skillIndexRowOf(summary('beta'), true)])
  const result = await index.search({ query: 'alpha beta' }, { allowedSkillKeys: new Set([skillKeyOf(summary('alpha'))]) })
  expect(result.results.map(hit => hit.name)).toEqual(['alpha'])
})
