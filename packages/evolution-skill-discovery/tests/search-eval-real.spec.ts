// @tier ci-only
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { SkillSearchIndex, skillIndexRowOf } from '../src/index.ts'

interface Fixture { schemaVersion: number; skills: Array<{ name: string; description: string; whenToUse: string }>; queries: Array<{ query: string; acceptable: string[] }>; queriesZh: Array<{ query: string; acceptable: string[] }>; noResultQuery: string }

it('replays the real managed-skill corpus with task queries', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/search-eval-real.json', import.meta.url), 'utf8')) as Fixture
  expect(fixture.schemaVersion).toBe(1)
  expect(fixture.skills.length).toBeGreaterThanOrEqual(30)
  expect(fixture.queries.length).toBeGreaterThanOrEqual(10)
  expect(fixture.queriesZh).toHaveLength(30)
  const rows = fixture.skills.map(skill => skillIndexRowOf({ ...skill, invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'dsh-evolution' } as SkillSummary, false))
  const index = SkillSearchIndex.fromRows('eval-real', rows)
  for (const query of fixture.queries) {
    const names = (await index.search({ query: query.query, limit: 5 })).results.map(result => result.name)
    expect(names.some(name => query.acceptable.includes(name)), query.query + ' => ' + names.join(',')).toBe(true)
  }
  for (const query of fixture.queriesZh) {
    const top3 = (await index.search({ query: query.query, limit: 3 })).results.map(result => result.name)
    const top5 = (await index.search({ query: query.query, limit: 5 })).results.map(result => result.name)
    expect(top3.some(name => query.acceptable.includes(name)), 'zh@3 ' + query.query + ' => ' + top3.join(',')).toBe(true)
    expect(top5.some(name => query.acceptable.includes(name)), 'zh@5 ' + query.query + ' => ' + top5.join(',')).toBe(true)
  }
  const none = await index.search({ query: fixture.noResultQuery, limit: 5 })
  expect(none.results).toHaveLength(0)
  expect(none.fallback).not.toBe(true)
})
