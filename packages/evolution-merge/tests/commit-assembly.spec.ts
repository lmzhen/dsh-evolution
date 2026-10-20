// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { assembleStagedCommit, createStaging, writeStagedFile } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')

const input = (runId: string) => ({
  runId,
  target: 'umbrella',
  sources: [
    { name: 'a', body: BODY('a'), files: [] },
    { name: 'b', body: BODY('b'), files: [] },
  ],
  promptVersion: 'p1',
  ttlDays: 7,
  now: () => 1000,
})

it('assembles a create plan from staged bytes and live source bodies', async () => {
  const home = await tempRoot('dsh-merge-commit-assembly-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('old-name'))).ok).toBe(true)
  const result = await assembleStagedCommit(io, home, 'run-1', {
    async readSkill(name) { return name === 'a' ? BODY('a') : name === 'b' ? BODY('b') : null },
  }, { origin: 'foreground', summary: 'merge a+b' })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  if (!result.ok) return
  expect(result.plan).toMatchObject({ target: 'umbrella', targetExists: false, sources: ['a', 'b'] })
  expect(result.plan.body).toContain('name: umbrella')
  expect(result.plan.expectedSourceBodies).toEqual([{ name: 'a', body: BODY('a') }, { name: 'b', body: BODY('b') }])
})

it('refuses when a source is no longer live', async () => {
  const home = await tempRoot('dsh-merge-commit-assembly-missing-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('umbrella'))).ok).toBe(true)
  const result = await assembleStagedCommit(io, home, 'run-1', {
    async readSkill(name) { return name === 'a' ? BODY('a') : null },
  }, { origin: 'foreground', summary: 'merge' })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.message).toContain('source skill is not live')
})
