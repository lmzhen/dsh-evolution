// @tier pre-tag
import { expect, it } from 'vitest'
import { buildRound1Prompt, buildRound2Prompt, MERGE_PROMPT_VERSION, STANDBY_PROMPT, type MergeDecision, type MergeRow, type SkillCard } from '../src/index.ts'

const cards: SkillCard[] = [
  { name: 'alpha-skill', description: 'a', body: 'alpha body' },
  { name: 'beta-skill', description: 'b', body: 'beta body' },
]
const decision: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'alpha-skill', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }
const row: MergeRow = { id: 'mr_a', pairKey: 'a\u0000b', a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'retry', createdAt: 'x', updatedAt: 'x' }

it('round1 is the B decision prompt with merge_stage reads', () => {
  const prompt = buildRound1Prompt({ a: 'alpha-skill', b: 'beta-skill' }, cards)
  expect(prompt).toContain('第 1 轮只做判断')
  expect(prompt).toContain('merge_stage 的 list/read')
  expect(prompt).toContain('sources/alpha-skill')
  expect(prompt).toContain('a_summary')
  expect(prompt).not.toContain('alpha body')
  expect(MERGE_PROMPT_VERSION).toBe('merge-b/v1')
})

it('round2 is the B author prompt, fresh adds only the bridge sentence', () => {
  const prompt = buildRound2Prompt(row, decision)
  expect(prompt).toContain('现在执行第 2 轮')
  expect(prompt).toContain('merged/alpha-skill/')
  expect(prompt).toContain('不要修改 sources/alpha-skill 或 sources/beta-skill')
  expect(prompt).toContain('shouldMerge')
  expect(prompt).not.toContain('基于已持久化的 decision')
  expect(buildRound2Prompt(row, decision, 'fresh')).toContain('基于已持久化的 decision。')
  expect(STANDBY_PROMPT.length).toBeGreaterThan(0)
})
