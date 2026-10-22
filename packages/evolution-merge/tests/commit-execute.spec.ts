// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { commitReceiptPath, commitStagedRun, createStaging, readCommitReceipt, writeStagedFile } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')

const input = (runId: string) => ({
  runId,
  target: 'umbrella',
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
})

it('commit survives a failing journal write', async () => {
  const home = await tempRoot('dsh-merge-commit-journal-fail-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
  const flaky = new Proxy(io, {
    get(target, prop) {
      if (prop === 'writeText') return async (path: string, content: string) => {
        if (path.includes('journals')) throw new Error('journal disk full')
        return target.writeText(path, content)
      }
      return Reflect.get(target, prop, target)
    },
  })
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
})
