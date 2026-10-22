// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createMergeRuntime, loadMergeState, pairKey, rowIdOf, stageKeyOf, upsertRow, writeStagedFile, type MergeRuntimeDeps, type MergeRow, type SkillCard } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')
const cards: SkillCard[] = [{ name: 'alpha-skill', description: 'a', body: BODY('alpha-skill'), managed: true }, { name: 'beta-skill', description: 'b', body: BODY('beta-skill'), managed: true }, { name: 'umbrella', description: 'u', body: BODY('umbrella'), managed: true }]
const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'umbrella', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }

it('approves a pending row through a new child and drops it after commit', async () => {
  const home = await tempRoot('dsh-merge-runtime-approve-')
  const io = nodeEvolutionIo()
  const key = pairKey('alpha-skill', 'beta-skill')
  const row: MergeRow = { id: rowIdOf(key), pairKey: key, a: 'alpha-skill', b: 'beta-skill', state: 'pending', queue: 'pending', decision, createdAt: 'x', updatedAt: 'x' }
  await upsertRow(io, home, () => 1, row)
  const registry: MergeRuntimeDeps['registry'] = {
    async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 1 } },
    async stage() {},
    async settle() {},
  }
  const skills = {
    async list() { return cards },
    async read(name: string) { return cards.find(card => card.name === name)?.body ?? null },
    async commitMerge(plan: { sources: string[] }) { return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 3 } },
  } as unknown as SkillLibrary
  const stageKey = stageKeyOf('run-1', key)
  const channel = {
    async open() { return { kind: 'ok' as const, childId: 'child-2', turn: { text: 'standby', stopReason: 'completed' } } },
    async continueTurn() { await writeStagedFile(io, home, stageKey, 'SKILL.md', BODY('umbrella')); return { kind: 'ok' as const, childId: 'child-2', turn: { text: 'written', stopReason: 'completed' } } },
    async dispose() {},
  }
  const deps: MergeRuntimeDeps = {
    io, home, registry, skills, now: () => 200,
    params: { mergeApproval: true, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel, parent: {}, allow: [], timeoutMinutes: 0,
    cards: async () => cards, screeningForRun: async () => [],
  }
  const result = await createMergeRuntime(deps).execute({ verb: 'approve', id: row.id })
  expect(result.ok, result.text).toBe(true)
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
})
