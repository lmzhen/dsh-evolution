// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { commitStagedRun, createStaging, readCommitReceipt, skillLibraryPort, writeStagedFile } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: adapter fixture', '---', '', '# ' + name, ''].join('\n')

it('commits through SkillLibrary and archives the source', async () => {
  const home = await tempRoot('dsh-merge-library-port-')
  const io = nodeEvolutionIo()
  const lib = new SkillLibrary(home)
  await lib.create('target', BODY('target'), 'foreground')
  await lib.create('src', BODY('src'), 'foreground')
  const sourceBody = (await lib.read('src')) ?? ''
  expect((await createStaging(io, home, {
    runId: 'run-1',
    target: 'target',
    sources: [{ name: 'src', body: sourceBody, files: [] }],
    promptVersion: 'p1',
    ttlDays: 7,
    now: () => 1000,
  })).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', BODY('target'))).ok).toBe(true)
  const result = await commitStagedRun(io, home, 'run-1', skillLibraryPort(lib), {
    origin: 'foreground',
    summary: 'adapter merge',
    now: () => 2000,
  })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  if (!result.ok) return
  expect(result.result.unitId).toBeDefined()
  expect(await lib.read('src')).toBeNull()
  expect(await lib.read('target')).toContain('# target')
  expect(await readCommitReceipt(io, home, 'run-1')).toMatchObject({ target: 'target', sources: ['src'], at: 2000 })
})
