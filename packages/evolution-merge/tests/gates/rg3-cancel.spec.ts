// @tier pre-tag
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, nodeEvolutionIo, readUnitJournal, SkillLibrary, skillLibraryUnitBackend, UnitTransactions, writeUnitJournal, type UnitBackend, type UnitPlan } from '@deepseek-ai/dsh-evolution-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempRoot } from '../../../test-support/temp-home.ts'

it('cancels a prepared unit before any tree write', async () => {
  const home = await tempRoot('dsh-rg3-cancel-')
  const tree = new Map<string, string>([['alpha', 'old']])
  const backend: UnitBackend = { async readSkill(n) { return tree.get(n) ?? null }, async readSupportFile() { return null }, async commit() { throw new Error('must not commit') }, async restoreTarget() {}, async restoreSource() {} }
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend, claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const plan: UnitPlan = { runId: 'run-1', pairKey: 'alpha', target: 'alpha', targetExists: true, sources: [], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [], origin: 'foreground', summary: 's' }
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  expect(await tx.cancel(prepared.prepared.unitId, 'test')).toMatchObject({ ok: true, phase: 'prepared' })
  const committed = await tx.commit(prepared.prepared)
  expect(committed.ok).toBe(false)
  if (committed.ok) return
  expect(committed.code).toBe('unit-plan-missing')
})

it('cancels at a phase boundary by rolling back the partial tree', async () => {
  const home = await tempRoot('dsh-rg3-cancel-phase-')
  const tree = new Map<string, string>([['alpha', 'old']])
  const backend: UnitBackend = { async readSkill(n) { return tree.get(n) ?? null }, async readSupportFile() { return null }, async commit() { throw new Error('must not commit') }, async restoreTarget(n, body) { if (body === null) tree.delete(n); else tree.set(n, body) }, async restoreSource(n, body) { tree.set(n, body) } }
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend, claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const plan: UnitPlan = { runId: 'run-2', pairKey: 'alpha', target: 'alpha', targetExists: true, sources: [], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [], origin: 'foreground', summary: 's' }
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const journal = await readUnitJournal(nodeEvolutionIo(), home, prepared.prepared.unitId)
  if (journal === null) throw new Error('journal missing')
  tree.set('alpha', 'new')
  await writeUnitJournal(nodeEvolutionIo(), home, { ...journal, phase: 'target-written', updatedAt: 2 })
  const result = await tx.cancel(prepared.prepared.unitId, 'phase-boundary')
  expect(result).toMatchObject({ ok: true, phase: 'target-written' })
  expect(tree.get('alpha')).toBe('old')
})

it('aborts inside commit and rolls back the partial tree', async () => {
  const home = await tempRoot('dsh-rg3-cancel-internal-')
  const io = nodeEvolutionIo()
  for (const name of ['alpha', 'beta']) {
    await mkdir(join(home, name), { recursive: true })
    await writeFile(join(home, name, 'SKILL.md'), ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n'))
  }
  await writeFile(join(home, 'alpha', '.hermes-managed'), '')
  const skills = new SkillLibrary(home, io, DEFAULT_SKILL_LIMITS)
  const controller = new AbortController()
  const tx = new UnitTransactions({ io, home, backend: skillLibraryUnitBackend(skills), claim: { async acquire() { return { async release() {} } } }, now: () => 1, onPhase: phase => { if (phase === 'target-written') controller.abort() } })
  const prepared = await tx.prepare({ runId: 'run-cancel', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body: ['---', 'name: alpha', 'description: merged', '---', '', '# alpha', ''].join('\n'), supportFiles: [], expectedTargetBody: await skills.read('alpha'), expectedSourceBodies: [{ name: 'beta', body: await skills.read('beta') ?? '' }], origin: 'foreground', summary: 'merge' })
  if (!prepared.ok) throw new Error(prepared.message)
  const result = await tx.commit(prepared.prepared, { signal: controller.signal })
  expect(result.ok).toBe(false)
  expect(await skills.read('alpha')).toContain('# alpha')
  expect(await skills.read('beta')).toContain('# beta')
})
