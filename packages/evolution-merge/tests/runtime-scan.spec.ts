// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createMergeRuntime, pairKey, stageKeyOf, writeStagedFile, type MergeRuntimeDeps, type SkillCard } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')
const cards: SkillCard[] = [{ name: 'alpha-skill', description: 'a', body: BODY('alpha-skill') }, { name: 'beta-skill', description: 'b', body: BODY('beta-skill') }]
const decision = { should_merge: true, mode: 'merge-into-existing', target: 'umbrella', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }

it('runs a scan through the runtime registry/channel/commit path', async () => {
  const home = await tempRoot('dsh-merge-runtime-scan-')
  const io = nodeEvolutionIo()
  const registry: MergeRuntimeDeps['registry'] = {
    async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 1 } },
    async stage() {},
    async settle() {},
  }
  const skills = {
    async list() { return cards.map(card => ({ name: card.name, description: card.description, content: card.body })) },
    async read(name: string) { return cards.find(card => card.name === name)?.body ?? null },
    async commitMerge(plan: { sources: string[] }) { return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 3 } },
  } as unknown as SkillLibrary
  const stageKey = stageKeyOf('run-1', pairKey('alpha-skill', 'beta-skill'))
  let first = true
  const channel = {
    async open() { return { kind: 'ok' as const, childId: 'child-1', turn: { text: 'standby', stopReason: 'completed' } } },
    async continueTurn() {
      if (first) { first = false; return { kind: 'ok' as const, childId: 'child-1', turn: { text: JSON.stringify(decision), stopReason: 'completed' } } }
      await writeStagedFile(io, home, stageKey, 'SKILL.md', BODY('umbrella'))
      return { kind: 'ok' as const, childId: 'child-1', turn: { text: 'written', stopReason: 'completed' } }
    },
    async dispose() {},
  }
  const deps: MergeRuntimeDeps = {
    io, home, registry, skills, now: () => 200,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel, parent: {}, allow: [], timeoutMinutes: 0,
    cards: async () => cards,
    screeningForRun: async () => [{ a: 'alpha-skill', b: 'beta-skill' }],
  }
  const result = await createMergeRuntime(deps).execute({ verb: 'scan' })
  expect(result.ok, result.text).toBe(true)
  expect(result.text).toContain('merged 1')
})