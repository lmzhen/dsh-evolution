// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, SkillLibrary, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { skillLibraryUnitBackend } from '../src/unit-backend.ts'
import { UnitTransactions, type UnitPlan } from '../src/unit-transaction.ts'

it('commits through the real SkillLibrary adapter', async () => {
  const root = await tempRoot('dsh-unit-backend-')
  for (const name of ['alpha', 'beta']) {
    await mkdir(join(root, name), { recursive: true })
    await writeFile(join(root, name, 'SKILL.md'), ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n'))
  }
  await writeFile(join(root, 'alpha', '.hermes-managed'), '')
  const skills = new SkillLibrary(root, nodeEvolutionIo(), DEFAULT_SKILL_LIMITS)
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home: root, backend: skillLibraryUnitBackend(skills), claim: { async acquire() { return { async release() {} } } } })
  const plan: UnitPlan = { runId: 'run-1', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body: ['---', 'name: alpha', 'description: merged', '---', '', '# alpha', ''].join('\n'), supportFiles: [], expectedTargetBody: await skills.read('alpha'), expectedSourceBodies: [{ name: 'beta', body: await skills.read('beta') ?? '' }], origin: 'foreground', summary: 'merge' }
  const prepared = await tx.prepare(plan)
  expect(prepared.ok).toBe(true)
  if (!prepared.ok) return
  const committed = await tx.commit(prepared.prepared)
  expect(committed.ok, committed.ok ? '' : committed.message).toBe(true)
  if (!committed.ok) return
  expect(await skills.read('alpha')).toContain('merged')
  expect(await skills.read('beta')).toBeNull()
})
