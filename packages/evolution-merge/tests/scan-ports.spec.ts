// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createChannelScanPorts, runScan, writeStagedFile, type CommitPort, type ConversationChannelLike, type SkillCard } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')
const cards: SkillCard[] = [{ name: 'alpha-skill', description: 'a', body: BODY('alpha-skill') }, { name: 'beta-skill', description: 'b', body: BODY('beta-skill') }]
const decision = { should_merge: true, mode: 'merge-into-existing', target: 'umbrella', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }

function commitPort(): CommitPort {
  return {
    async readSkill(name) { return cards.find(card => card.name === name)?.body ?? null },
    async commitMerge(plan) { return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 3 } },
  }
}

it('runs scan through channel authoring and commit', async () => {
  const home = await tempRoot('dsh-merge-scan-ports-')
  const io = nodeEvolutionIo()
  let disposed = 0
  const channel: ConversationChannelLike = {
    async open() { return { kind: 'ok', childId: 'child-1', turn: { text: JSON.stringify(decision), stopReason: 'completed' } } },
    async continueTurn() {
      expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
      return { kind: 'ok', childId: 'child-1', turn: { text: 'written', stopReason: 'completed' } }
    },
    async dispose() { disposed += 1 },
  }
  const ports = createChannelScanPorts({
    io, home, runId: 'run-1', cards,
    screening: async () => [{ a: 'alpha-skill', b: 'beta-skill' }],
    channel, parent: {}, allow: [], timeoutMs: 1000, approval: false, commitPort: commitPort(), now: () => 200,
  })
  const draft = await runScan({ io, home, now: () => 200, signal: new AbortController().signal, approval: false, ports })
  expect(draft.totals).toEqual({ merged: 1, kept: 0, pending: 0, failed: 0 })
  expect(disposed).toBe(1)
})
