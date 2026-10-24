// @tier pre-tag
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { acquireTreeWriteLock, DEFAULT_SKILL_LIMITS, nodeEvolutionIo, readUnitEvidence, SkillLibrary, skillLibraryUnitBackend, treeLockFile, UnitTransactions, type UnitBackend, type UnitPlan } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { mergeDoctor } from '../../src/doctor.ts'

it('rejects an old writer after takeover and keeps the new fence', async () => {
  const home = await tempRoot('dsh-rg4-fence-')
  const io = nodeEvolutionIo()
  const first = await acquireTreeWriteLock({ io, home, waitMs: 0 })
  if (!first.ok) throw new Error('first lock failed')
  await writeFile(treeLockFile(home), JSON.stringify({ token: 'new', epoch: first.lock.epoch + 1, pid: 999999, startedAt: 1 }))
  const second = await acquireTreeWriteLock({ io, home, waitMs: 0 })
  if (!second.ok) throw new Error('second lock failed')
  expect(second.lock.epoch).toBe(first.lock.epoch + 2)
  expect(await first.lock.assertHeld()).toBe(false)
  await first.lock.release()
  expect(JSON.parse(await readFile(treeLockFile(home), 'utf8')).token).toBe(second.lock.token)
  expect(await second.lock.assertHeld()).toBe(true)
  let writes = 0
  const oldWriter = async (): Promise<boolean> => {
    if (!(await first.lock.assertHeld())) return false
    writes += 1
    await writeFile(join(home, 'tree-write'), 'old')
    return true
  }
  expect(await oldWriter()).toBe(false)
  expect(writes).toBe(0)
  await second.lock.release()
})

it('rejects a commit whose fence is lost mid-flight', async () => {
  const home = await tempRoot('dsh-rg4-takeover-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old']])
  const backend: UnitBackend = {
    async readSkill(n) { return tree.get(n) ?? null }, async readSupportFile() { return null },
    async commit(plan, onPhase, _signal, assertFence) { await onPhase?.('target-pending'); await writeFile(treeLockFile(home), JSON.stringify({ token: 'other', epoch: 99, pid: process.pid, startedAt: 1 })); if (assertFence !== undefined && !(await assertFence())) return { ok: false, message: 'tree fence lost before target write' }; tree.set(plan.target, plan.body); await onPhase?.('target-written'); return { ok: true, message: 'merged', archived: [], mutations: 1 } },
    async restoreTarget() {}, async restoreSource() {},
  }
  const tx = new UnitTransactions({ io, home, backend, claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const plan: UnitPlan = { runId: 'run-takeover', pairKey: 'alpha', target: 'alpha', targetExists: true, sources: [], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [], origin: 'foreground', summary: 's' }
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const result = await tx.commit(prepared.prepared)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.code).toBe('unit-fence-failed')
  expect(tree.get('alpha')).toBe('old')
  expect(await readUnitEvidence(io, home, prepared.prepared.unitId)).toBeNull()
})

it('real commitMerge refuses target write after takeover', async () => {
  const home = await tempRoot('dsh-rg4-real-takeover-')
  const io = nodeEvolutionIo()
  for (const name of ['alpha', 'beta']) {
    await mkdir(join(home, name), { recursive: true })
    await writeFile(join(home, name, 'SKILL.md'), ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n'))
  }
  await writeFile(join(home, 'alpha', '.hermes-managed'), '')
  const skills = new SkillLibrary(home, io, DEFAULT_SKILL_LIMITS)
  const tx = new UnitTransactions({ io, home, backend: skillLibraryUnitBackend(skills), claim: { async acquire() { return { async release() {} } } }, now: () => 1, onPhase: async phase => { if (phase === 'target-pending') await writeFile(treeLockFile(home), JSON.stringify({ token: 'other', epoch: 99, pid: process.pid, startedAt: 1 })) } })
  const plan: UnitPlan = { runId: 'run-real-takeover', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body: ['---', 'name: alpha', 'description: merged', '---', '', '# alpha', ''].join('\n'), supportFiles: [], expectedTargetBody: await skills.read('alpha'), expectedSourceBodies: [{ name: 'beta', body: await skills.read('beta') ?? '' }], origin: 'foreground', summary: 'merge' }
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const result = await tx.commit(prepared.prepared)
  expect(result.ok).toBe(false)
  expect(await skills.read('alpha')).toContain('# alpha')
  expect(await skills.read('beta')).toContain('# beta')
  expect(await readUnitEvidence(io, home, prepared.prepared.unitId)).toBeNull()
})

it('real commitMerge refuses support write after takeover', async () => {
  const home = await tempRoot('dsh-rg4-support-takeover-')
  const io = nodeEvolutionIo()
  for (const name of ['alpha', 'beta']) {
    await mkdir(join(home, name), { recursive: true })
    await writeFile(join(home, name, 'SKILL.md'), ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n'))
  }
  await writeFile(join(home, 'alpha', '.hermes-managed'), '')
  const skills = new SkillLibrary(home, io, DEFAULT_SKILL_LIMITS)
  const tx = new UnitTransactions({ io, home, backend: skillLibraryUnitBackend(skills), claim: { async acquire() { return { async release() {} } } }, now: () => 1, onPhase: async phase => { if (phase === 'support-pending') await writeFile(treeLockFile(home), JSON.stringify({ token: 'other', epoch: 99, pid: process.pid, startedAt: 1 })) } })
  const plan: UnitPlan = { runId: 'run-support-takeover', pairKey: 'alpha|beta', target: 'umbrella', targetExists: false, sources: ['alpha', 'beta'], body: ['---', 'name: umbrella', 'description: merged', '---', '', '# umbrella', ''].join('\n'), supportFiles: [{ path: 'references/a.md', content: 'support' }], expectedTargetBody: null, expectedSourceBodies: [{ name: 'alpha', body: await skills.read('alpha') ?? '' }, { name: 'beta', body: await skills.read('beta') ?? '' }], origin: 'foreground', summary: 'merge' }
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const result = await tx.commit(prepared.prepared)
  expect(result.ok).toBe(false)
  expect(await skills.readSupportFile('umbrella', 'references/a.md')).toBeNull()
})

it('normal support commit persists support-pending before committed', async () => {
  const home = await tempRoot('dsh-rg4-support-ok-')
  const io = nodeEvolutionIo()
  for (const name of ['alpha', 'beta']) {
    await mkdir(join(home, name), { recursive: true })
    await writeFile(join(home, name, 'SKILL.md'), ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n'))
  }
  const skills = new SkillLibrary(home, io, DEFAULT_SKILL_LIMITS)
  const phases: string[] = []
  const tx = new UnitTransactions({ io, home, backend: skillLibraryUnitBackend(skills), claim: { async acquire() { return { async release() {} } } }, now: () => 1, onPhase: phase => { phases.push(phase) } })
  const plan: UnitPlan = { runId: 'run-support-ok', pairKey: 'alpha|beta', target: 'umbrella', targetExists: false, sources: ['alpha', 'beta'], body: ['---', 'name: umbrella', 'description: merged', '---', '', '# umbrella', ''].join('\n'), supportFiles: [{ path: 'references/a.md', content: 'support' }], expectedTargetBody: null, expectedSourceBodies: [{ name: 'alpha', body: await skills.read('alpha') ?? '' }, { name: 'beta', body: await skills.read('beta') ?? '' }], origin: 'foreground', summary: 'merge' }
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const result = await tx.commit(prepared.prepared)
  expect(result.ok).toBe(true)
  expect(phases).toContain('support-pending')
  const journal = await (await import('@deepseek-ai/dsh-evolution-core')).readUnitJournal(io, home, prepared.prepared.unitId)
  expect(journal?.phase).toBe('committed')
})

it('bounded wait returns tree-lock-busy instead of hanging', async () => {
  const home = await tempRoot('dsh-rg4-wait-')
  const io = nodeEvolutionIo()
  const held = await acquireTreeWriteLock({ io, home, waitMs: 0 })
  if (!held.ok) throw new Error('lock failed')
  const started = Date.now()
  const second = await acquireTreeWriteLock({ io, home, waitMs: 100 })
  expect(second.ok).toBe(false)
  if (second.ok) return
  expect(second.reason).toBe('busy')
  expect(Date.now() - started).toBeLessThan(2_000)
  await held.lock.release()
})

it('doctor shows the tree lock holder', async () => {
  const home = await tempRoot('dsh-rg4-doctor-')
  const io = nodeEvolutionIo()
  const lock = await acquireTreeWriteLock({ io, home, waitMs: 0 })
  if (!lock.ok) throw new Error('lock failed')
  const rows = await mergeDoctor(io, home)
  expect(rows.find(row => row.key === 'tree-lock')?.detail).toContain('pid=')
  await lock.lock.release()
})
