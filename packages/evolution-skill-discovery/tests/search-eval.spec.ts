import { describe, expect, it } from 'vitest'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { SkillSearchIndex, skillIndexRowOf } from '../src/index.ts'

function summary(name: string, description: string): SkillSummary {
  return { name, description, whenToUse: 'when ' + description, invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'dsh-evolution' }
}
const skills = Array.from({ length: 200 }, (_, index) => {
  const id = String(index).padStart(3, '0')
  return summary('skill-' + id, '技能描述' + id)
})
const rows = skills.map(skill => skillIndexRowOf(skill, false))
const index = SkillSearchIndex.fromRows('eval-view', rows)

describe('EVAL-005 lexical acceptance fixture', () => {
  it('meets Chinese recall@3/@5 and exact-name top1', async () => {
    const queries = Array.from({ length: 30 }, (_, index) => ({ query: '技能描述' + String(index * 6).padStart(3, '0'), expected: 'skill-' + String(index * 6).padStart(3, '0') }))
    let hit3 = 0
    let hit5 = 0
    for (const item of queries) {
      const top5 = (await index.search({ query: item.query, limit: 5 })).results.map(result => result.name)
      if (top5.slice(0, 3).includes(item.expected)) hit3 += 1
      if (top5.includes(item.expected)) hit5 += 1
    }
    expect(hit3 / queries.length).toBeGreaterThanOrEqual(0.8)
    expect(hit5 / queries.length).toBeGreaterThanOrEqual(0.9)
    for (const skill of skills.slice(0, 30)) {
      const top = (await index.search({ query: skill.name, limit: 3 })).results[0]?.name
      expect(top).toBe(skill.name)
    }
  })

  it('keeps 200-skill p95 search under 50ms', async () => {
    const timings: number[] = []
    for (let run = 0; run < 5; run += 1) {
      for (let queryIndex = 0; queryIndex < 30; queryIndex += 1) {
        const start = performance.now()
        await index.search({ query: '技能描述' + String(queryIndex * 6).padStart(3, '0'), limit: 5 })
        timings.push(performance.now() - start)
      }
    }
    timings.sort((left, right) => left - right)
    const p95 = timings[Math.floor(timings.length * 0.95)] ?? Infinity
    expect(p95).toBeLessThan(50)
  })
})
