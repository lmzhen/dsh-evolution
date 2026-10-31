// @tier ci-only
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { SkillSearchIndex, skillIndexRowOf, type SkillIndexRow } from '../src/index.ts'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'

interface Fixture { schemaVersion: number; skills: Array<{ name: string; description: string; whenToUse: string }>; queries: Array<{ query: string; acceptable: string[] }>; noResultQuery: string }

it('replays the EVAL-010 mixed-language fixture without hard-coding a judge sentence', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/search-eval-010.json', import.meta.url), 'utf8')) as Fixture
  expect(fixture.schemaVersion).toBe(1)
  expect(fixture.skills.length).toBeGreaterThanOrEqual(40)
  expect(fixture.queries).toHaveLength(30)
  const rows: SkillIndexRow[] = fixture.skills.map(skill => skillIndexRowOf({ ...skill, invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'dsh-evolution' } as SkillSummary, false))
  const index = SkillSearchIndex.fromRows('eval-010', rows)
  for (const query of fixture.queries) {
    const names = (await index.search({ query: query.query, limit: 5 })).results.map(result => result.name)
    expect(names.some(name => query.acceptable.includes(name))).toBe(true)
  }
  const none = await index.search({ query: fixture.noResultQuery, limit: 5 })
  expect(none.results).toHaveLength(0)
  expect(none.fallback).not.toBe(true)
})
