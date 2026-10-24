// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { commitReceiptPath, commitStagedRun, createStaging, readCommitReceipt, writeStagedFile } from '../src/index.ts'
import { readJournal } from '../src/domain/commit-journal-store.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')

const input = (runId: string) => ({
  runId,
  target: 'umbrella',
  mode: 'create-umbrella' as const,
  sources: [{ name: 'a', body: BODY('a'), files: [] }, { name: 'b', body: BODY('b'), files: [] }],
  promptVersion: 'p1',
  ttlDays: 7,
  now: () => 1000,
})

it('commits a staged tree and writes a receipt', async () => {
  const home = await tempRoot('dsh-merge-commit-exec-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
  const result = await commitStagedRun(io, home, 'run-1', {
    async readSkill(name) { return name === 'a' ? BODY('a') : name === 'b' ? BODY('b') : null },
    async commitMerge(plan) {
      expect(plan.target).toBe('umbrella')
      return { ok: true, message: 'merged', unitId: 'u-1', archived: ['a', 'b'], mutations: 3 }
    },
  }, { origin: 'foreground', summary: 'merge', now: () => 2000 })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  if (!result.ok) return
  expect(result.receipt).toMatchObject({ runId: 'run-1', unitId: 'u-1', target: 'umbrella', create: true, sources: ['a', 'b'], archived: ['a', 'b'] })
  expect(await io.readText(commitReceiptPath(home, 'run-1'))).toContain('u-1')
  expect(await readCommitReceipt(io, home, 'run-1')).toMatchObject({ unitId: 'u-1' })
  expect(await readJournal(io, home, 'run-1')).toMatchObject({ phase: 'committed', unitId: 'u-1' })
})


it('commits through the UnitTransaction branch without calling commitMerge', async () => {
  const home = await tempRoot('dsh-merge-commit-unit-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
  const unit = {
    async prepare(plan: { unitId?: string }) { return { ok: true as const, prepared: { unitId: 'u-unit', planDigest: 'd1' } } },
    async commit() { return { ok: true as const, evidence: { unitId: 'u-unit', runId: 'run-1', planDigest: 'd1', state: 'complete' as const, target: { before: null, after: BODY('umbrella'), supportDigest: '', created: true }, sources: [{ name: 'a', before: BODY('a'), after: null, archived: true, absorbedInto: 'umbrella' }, { name: 'b', before: BODY('b'), after: null, archived: true, absorbedInto: 'umbrella' }], mutations: 3, at: 1 } } },
    async verify() { return null },
    async rollback() { return { ok: false as const, code: 'unit-committed' as const, message: 'no' } },
    async cancel() { return { ok: false, phase: 'none' as const } },
  }
  const result = await commitStagedRun(io, home, 'run-1', {
    async readSkill(name) { return name === 'a' ? BODY('a') : name === 'b' ? BODY('b') : null },
    async commitMerge() { throw new Error('old path must not run') },
  }, { origin: 'foreground', summary: 'merge', now: () => 2000, unit: unit as never })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  if (!result.ok) return
  expect(result.receipt).toMatchObject({ unitId: 'u-unit', archived: ['a', 'b'] })
})

it('commit survives a failing journal write', async () => {
  const home = await tempRoot('dsh-merge-commit-journal-fail-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
  const flaky = {
    ...io,
    async writeText(path: string, content: string) {
      if (path.includes('journals')) throw new Error('journal disk full')
      await io.writeText(path, content)
    },
  }
  const result = await commitStagedRun(flaky, home, 'run-1', {
    async readSkill(name) { return name === 'a' ? BODY('a') : name === 'b' ? BODY('b') : null },
    async commitMerge() { return { ok: true, message: 'merged', unitId: 'u-1', archived: ['a', 'b'], mutations: 3 } },
  }, { origin: 'foreground', summary: 'merge', now: () => 2000 })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  expect(await readCommitReceipt(io, home, 'run-1')).toMatchObject({ unitId: 'u-1' })
})

it('does not write a receipt when commit fails', async () => {
  const home = await tempRoot('dsh-merge-commit-exec-fail-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
  const result = await commitStagedRun(io, home, 'run-1', {
    async readSkill(name) { return name === 'a' ? BODY('a') : name === 'b' ? BODY('b') : null },
    async commitMerge() { return { ok: false, message: 'commit refused' } },
  }, { origin: 'foreground', summary: 'merge', now: () => 2000 })
  expect(result.ok).toBe(false)
  expect(await readCommitReceipt(io, home, 'run-1')).toBeNull()
  expect(await readJournal(io, home, 'run-1')).toMatchObject({ phase: 'failed' })
})

it('keeps the journal prepared when commitMerge throws', async () => {
  const home = await tempRoot('dsh-merge-commit-throw-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
  await expect(commitStagedRun(io, home, 'run-1', {
    async readSkill(name) { return name === 'a' ? BODY('a') : name === 'b' ? BODY('b') : null },
    async commitMerge() { throw new Error('commit unknown') },
  }, { origin: 'foreground', summary: 'merge', now: () => 2000 })).rejects.toThrow('commit unknown')
  expect(await readJournal(io, home, 'run-1')).toMatchObject({ phase: 'prepared' })
  expect(await readCommitReceipt(io, home, 'run-1')).toBeNull()
})
