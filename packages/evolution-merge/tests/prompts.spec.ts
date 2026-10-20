// @tier pre-tag
import { expect, it } from 'vitest'
import { buildRound1Prompt, buildRound2Prompt, MERGE_PROMPT_VERSION, type MergeDecision, type MergeRow, type SkillCard } from '../src/index.ts'

const cards: SkillCard[] = [
  { name: 'alpha-skill', description: 'a', body: 'alpha body' },
  { name: 'beta-skill', description: 'b', body: 'beta body' },
]
const decision: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'alpha-skill', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }
const row: MergeRow = { id: 'mr_a', pairKey: 'a\u0000b', a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'retry', createdAt: 'x', updatedAt: 'x' }

it('round1 asks only for a decision JSON', () => {
  const prompt = buildRound1Prompt({ a: 'alpha-skill', b: 'beta-skill' }, cards)
  expect(prompt).toContain('should_merge')
  expect(prompt).toContain('alpha body')
  expect(prompt).toContain('beta body')
  expect(prompt).not.toContain('merge_stage')
  expect(MERGE_PROMPT_VERSION).toBe('merge-pair/v1')
})

it('round2 points at merge_stage and the staged target', () => {
  const prompt = buildRound2Prompt(row, decision)
  expect(prompt).toContain('merge_stage')
  expect(prompt).toContain('merged/alpha-skill/')
  expect(prompt).toContain('Never modify the live skill tree')
})
