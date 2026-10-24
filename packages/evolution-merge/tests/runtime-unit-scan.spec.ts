// @tier pre-tag
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, SkillLibrary, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createMergeRuntime, pairKey, stageKeyOf, writeStagedFile, type MergeRuntimeDeps, type SkillCard } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')
const decision = { should_merge: true, mode: 'create-umbrella', target: 'umbrella', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }

it('runs a real scan through UnitTransactions and SkillLibrary', async () => {
  const home = await tempRoot('dsh-merge-runtime-unit-')
  const io = nodeEvolutionIo()
  for (const name of ['alpha-skill', 'beta-skill']) {
    await mkdir(join(home, name), { recursive: true })
    await writeFile(join(home, name, 'SKILL.md'), BODY(name))
  }
  const skills = new SkillLibrary(home, io, DEFAULT_SKILL_LIMITS)
  const cards: SkillCard[] = [
    { name: 'alpha-skill', description: 'a', body: BODY('alpha-skill'), managed: true },
    { name: 'beta-skill', description: 'b', body: BODY('beta-skill'), managed: true },
  ]
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
    io, home, skills, now: () => 200,
    registry: { async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 1 } }, async stage() {}, async settle() {} },
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel, parent: {}, allow: [], timeoutMinutes: 0, detached: false,
    cards: async () => cards,
    screeningForRun: async () => [{ a: 'alpha-skill', b: 'beta-skill' }],
  }
  const result = await createMergeRuntime(deps).execute({ verb: 'scan' })
  expect(result.ok, result.text).toBe(true)
  expect(await skills.read('umbrella')).toContain('# umbrella')
  const stateBytes = await readFile(join(home, 'merge', 'merge-state.json'), 'utf8')
  expect(JSON.parse(stateBytes).schemaVersion).toBe(3)
})
