// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { runNewChildAuthoring, writeStagedFile, type CommitPort, type ConversationChannelLike, type MergeDecision, type MergeRow, type SkillCard } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')
const cards: SkillCard[] = [{ name: 'alpha-skill', description: 'a', body: BODY('alpha-skill') }, { name: 'beta-skill', description: 'b', body: BODY('beta-skill') }]
const row: MergeRow = { id: 'mr_a', pairKey: 'a\u0000b', a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'retry', createdAt: 'x', updatedAt: 'x' }
const decision: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'umbrella', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }

function commitPort(): CommitPort {
  return {
    async readSkill(name) { return cards.find(card => card.name === name)?.body ?? null },
    async commitMerge(plan) { return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 3 } },
  }
}

it('opens a new child, authors staging and commits', async () => {
  const home = await tempRoot('dsh-merge-new-child-')
  const io = nodeEvolutionIo()
  let disposed = 0
  const channel: ConversationChannelLike = {
    async open() {
      expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
      return { kind: 'ok', childId: 'child-2', turn: { text: 'written', stopReason: 'completed' } }
    },
    async continueTurn() { throw new Error('not used') },
    async dispose() { disposed += 1 },
  }
  const result = await runNewChildAuthoring({ io, home, runId: 'run-1', cards, channel, parent: {}, allow: [], timeoutMs: 1000, commitPort: commitPort(), now: () => 200 }, row, decision, new AbortController().signal)
  expect(result).toMatchObject({ kind: 'merged', unitId: 'u-1' })
  expect(disposed).toBe(1)
})

it('fails when the child writes no staging', async () => {
  const home = await tempRoot('dsh-merge-new-child-empty-')
  const io = nodeEvolutionIo()
  const channel: ConversationChannelLike = {
    async open() { return { kind: 'ok', childId: 'child-2', turn: { text: 'nothing', stopReason: 'completed' } } },
    async continueTurn() { throw new Error('not used') },
    async dispose() {},
  }
  const result = await runNewChildAuthoring({ io, home, runId: 'run-2', cards, channel, parent: {}, allow: [], timeoutMs: 1000, commitPort: commitPort(), now: () => 200 }, row, decision, new AbortController().signal)
  expect(result).toMatchObject({ kind: 'failed', failure: { stage: 'author' } })
})
