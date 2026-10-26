// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { pairKey, runNewChildAuthoring, stageKeyOf, writeStagedFile, type CommitPort, type ConversationChannelLike, type MergeDecision, type MergeRow, type SkillCard } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')
const cards: SkillCard[] = [{ name: 'alpha-skill', description: 'a', body: BODY('alpha-skill') }, { name: 'beta-skill', description: 'b', body: BODY('beta-skill') }]
const row: MergeRow = { id: 'mr_a', pairKey: pairKey('alpha-skill', 'beta-skill'), a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'fuse', createdAt: 'x', updatedAt: 'x' }
const decision: MergeDecision = { shouldMerge: true, mode: 'create-umbrella', target: 'umbrella', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }

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
    async open() { return { kind: 'ok', childId: 'child-2', turn: { text: 'standby', stopReason: 'completed' } } },
    async continueTurn() {
      expect((await writeStagedFile(io, home, stageKeyOf('run-1', pairKey('alpha-skill', 'beta-skill')), 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
      return { kind: 'ok', childId: 'child-2', turn: { text: 'written', stopReason: 'completed' } }
    },
    async dispose() { disposed += 1 },
  }
  const result = await runNewChildAuthoring({ io, home, runId: 'run-1', cards, channel, parent: {}, allow: [], timeoutMs: 1000, commitPort: commitPort(), now: () => 200 }, row, decision, new AbortController().signal)
  expect(result).toMatchObject({ kind: 'merged', unitId: 'u-1', manifestFiles: expect.arrayContaining(['SKILL.md']), criteria: { decision: 'merge', validation: 'required', commit: 'required', archive: 'sources', evidence: 'receipt' }, validationIssues: [] })
  expect(disposed).toBe(1)
})

it('fails when the child writes no staging', async () => {
  const home = await tempRoot('dsh-merge-new-child-empty-')
  const io = nodeEvolutionIo()
  const channel: ConversationChannelLike = {
    async open() { return { kind: 'ok', childId: 'child-2', turn: { text: 'standby', stopReason: 'completed' } } },
    async continueTurn() { return { kind: 'ok', childId: 'child-2', turn: { text: 'nothing', stopReason: 'completed' } } },
    async dispose() {},
  }
  const result = await runNewChildAuthoring({ io, home, runId: 'run-2', cards, channel, parent: {}, allow: [], timeoutMs: 1000, commitPort: commitPort(), now: () => 200 }, row, decision, new AbortController().signal)
  expect(result).toMatchObject({ kind: 'failed', failure: { stage: 'author' } })
})
it('allows round 2 to update a target support file (staged is not a conflict)', async () => { const home = await tempRoot('dsh-merge-new-child-support-conflict-'); const io = nodeEvolutionIo(); const targetCards: SkillCard[] = [...cards, { name: 'umbrella', description: 'u', body: BODY('umbrella'), managed: true, files: [{ path: 'references/x.md', content: 'target content' }] }]; const stageKey = stageKeyOf('run-4', pairKey('alpha-skill', 'beta-skill')); const channel: ConversationChannelLike = { async open() { return { kind: 'ok', childId: 'child-4', turn: { text: 'standby', stopReason: 'completed' } } }, async continueTurn() { await writeStagedFile(io, home, stageKey, 'SKILL.md', BODY('umbrella')); await writeStagedFile(io, home, stageKey, 'references/x.md', 'staged content'); return { kind: 'ok', childId: 'child-4', turn: { text: JSON.stringify({ target: 'umbrella', files: ['SKILL.md'] }), stopReason: 'completed' } } }, async dispose() {} }; let commits = 0; const port: CommitPort = { async readSkill(name) { return targetCards.find(card => card.name === name)?.body ?? null }, async commitMerge(plan) { commits += 1; return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 3 } } }; const existing = { ...decision, mode: 'merge-into-existing' as const, target: 'umbrella' }; const result = await runNewChildAuthoring({ io, home, runId: 'run-4', cards: targetCards, channel, parent: {}, allow: [], timeoutMs: 1000, commitPort: port, now: () => 400 }, row, existing, new AbortController().signal); expect(result).toMatchObject({ kind: 'merged' }); expect(commits).toBe(1) })

it('still rejects two source skills contributing different bytes at one support path', async () => { const home = await tempRoot('dsh-merge-new-child-source-conflict-'); const io = nodeEvolutionIo(); const conflicted: SkillCard[] = [{ ...cards[0]!, files: [{ path: 'references/x.md', content: 'alpha' }] }, { ...cards[1]!, files: [{ path: 'references/x.md', content: 'beta' }] }, { name: 'umbrella', description: 'u', body: BODY('umbrella'), managed: true }]; const stageKey = stageKeyOf('run-5', pairKey('alpha-skill', 'beta-skill')); const channel: ConversationChannelLike = { async open() { return { kind: 'ok', childId: 'child-5', turn: { text: 'standby', stopReason: 'completed' } } }, async continueTurn() { await writeStagedFile(io, home, stageKey, 'SKILL.md', BODY('umbrella')); return { kind: 'ok', childId: 'child-5', turn: { text: JSON.stringify({ target: 'umbrella', files: ['SKILL.md'] }), stopReason: 'completed' } } }, async dispose() {} }; let commits = 0; const port: CommitPort = { async readSkill(name) { return conflicted.find(card => card.name === name)?.body ?? null }, async commitMerge(plan) { commits += 1; return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 1 } } }; const result = await runNewChildAuthoring({ io, home, runId: 'run-5', cards: conflicted, channel, parent: {}, allow: [], timeoutMs: 1000, commitPort: port, now: () => 500 }, row, { ...decision, mode: 'merge-into-existing' as const, target: 'umbrella' }, new AbortController().signal); expect(result).toMatchObject({ kind: 'failed', failure: { code: 'merge-validation' } }); expect(commits).toBe(0) })

it('resolves a free actual target for create-umbrella', async () => {
  const home = await tempRoot('dsh-merge-new-child-v2-')
  const io = nodeEvolutionIo()
  const stageKey = stageKeyOf('run-3', pairKey('alpha-skill', 'beta-skill'))
  const channel: ConversationChannelLike = {
    async open() { return { kind: 'ok', childId: 'child-3', turn: { text: 'standby', stopReason: 'completed' } } },
    async continueTurn() {
      expect((await writeStagedFile(io, home, stageKey, 'SKILL.md', BODY('alpha-skill'))).ok).toBe(true)
      return { kind: 'ok', childId: 'child-3', turn: { text: 'written', stopReason: 'completed' } }
    },
    async dispose() {},
  }
  const umbrella = { ...decision, mode: 'create-umbrella' as const, target: 'alpha-skill' }
  const result = await runNewChildAuthoring({ io, home, runId: 'run-3', cards, channel, parent: {}, allow: [], timeoutMs: 1000, commitPort: commitPort(), now: () => 300 }, row, umbrella, new AbortController().signal)
  expect(result).toMatchObject({ kind: 'merged', target: { requested: 'alpha-skill', actual: 'alpha-skill-v2' } })
})
