// @tier pre-tag

import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, SkillLibrary, skillLibraryUnitBackend } from '@deepseek-ai/dsh-evolution-core'
import { nodeEvolutionIo, UnitTransactions, type UnitBackend, type UnitPlan } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'

function backend(tree: Map<string, string>): UnitBackend {
  return {
    async readSkill(name) { return tree.get(name) ?? null },
    async readSupportFile() { return null },
    async commit(plan) { tree.set(plan.target, plan.body); tree.delete('beta'); return { ok: true, message: 'merged', archived: ['beta'], mutations: 2 } },
    async restoreTarget(name, body) { if (body === null) tree.delete(name); else tree.set(name, body) },
    async restoreSource(name, body) { tree.set(name, body) },
  }
}
const plan: UnitPlan = { runId: 'run-1', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [{ name: 'beta', body: 'beta' }], origin: 'foreground', summary: 's' }

it('commits and exposes receipt-equivalent evidence', async () => {
  const home = await tempRoot('dsh-rg3-tx-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const committed = await tx.commit(prepared.prepared)
  expect(committed.ok).toBe(true)
  if (!committed.ok) return
  expect(committed.evidence).toMatchObject({ unitId: prepared.prepared.unitId, state: 'complete', target: { after: 'new' } })
  expect((await tx.verify({ unitId: prepared.prepared.unitId }))?.planDigest).toBe(prepared.prepared.planDigest)
})

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

it('drives real SkillLibrary commitMerge through the phase hooks', async () => {
  const home = await tempRoot('dsh-rg3-real-hooks-')
  const io = nodeEvolutionIo()
  for (const name of ['alpha', 'beta']) {
    await mkdir(join(home, name), { recursive: true })
    await writeFile(join(home, name, 'SKILL.md'), ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n'))
  }
  await writeFile(join(home, 'alpha', '.hermes-managed'), '')
  const skills = new SkillLibrary(home, io, DEFAULT_SKILL_LIMITS)
  const phases: string[] = []
  const tx = new UnitTransactions({ io, home, backend: skillLibraryUnitBackend(skills), claim: { async acquire() { return { async release() {} } } }, now: () => 1, onPhase: phase => { phases.push(phase) } })
  const p = await tx.prepare({ runId: 'run-real', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body: ['---', 'name: alpha', 'description: merged', '---', '', '# alpha', ''].join('\n'), supportFiles: [], expectedTargetBody: await skills.read('alpha'), expectedSourceBodies: [{ name: 'beta', body: await skills.read('beta') ?? '' }], origin: 'foreground', summary: 'merge' })
  if (!p.ok) throw new Error(p.message)
  const committed = await tx.commit(p.prepared)
  expect(committed.ok).toBe(true)
  expect(phases).toEqual(['prepared', 'target-pending', 'target-applied', 'target-written', 'source-archiving', 'sources-archived', 'unit-written', 'committed'])
})
