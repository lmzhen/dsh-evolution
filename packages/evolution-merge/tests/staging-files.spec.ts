// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { copyStagedFile, createStaging, listStagedFiles, readStagedFile, writeStagedFile } from '../src/index.ts'

const input = (runId: string) => ({
  runId,
  target: 'umbrella',
  sources: [{ name: 'a', body: 'body-a', files: [{ path: 'references/x.md', content: 'x' }] }],
  promptVersion: 'p1',
  ttlDays: 7,
  now: () => 1000,
})

it('writes/reads/lists merged files and copies source files', async () => {
  const home = await tempRoot('dsh-merge-stage-files-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect(await writeStagedFile(io, home, 'run-1', 'references/new.md', 'new')).toEqual({ ok: true, path: 'references/new.md' })
  expect(await readStagedFile(io, home, 'run-1', 'references/new.md', 'merged')).toMatchObject({ kind: 'present', value: 'new' })
  expect(await listStagedFiles(io, home, 'run-1', 'merged', 'references')).toMatchObject({ kind: 'present', value: ['new.md'] })
  expect(await copyStagedFile(io, home, 'run-1', 'a', 'references/x.md', 'references/copied.md')).toEqual({ ok: true, path: 'references/copied.md' })
  expect(await readStagedFile(io, home, 'run-1', 'references/copied.md', 'merged')).toMatchObject({ kind: 'present', value: 'x' })
})

it('refuses traversal and reports a missing staging as absent', async () => {
  const home = await tempRoot('dsh-merge-stage-files-guard-')
  const io = nodeEvolutionIo()
  expect((await writeStagedFile(io, home, 'missing', 'x', 'y')).ok).toBe(false)
  expect((await writeStagedFile(io, home, 'missing', '../x', 'y')).ok).toBe(false)
  expect(await readStagedFile(io, home, 'missing', 'x', 'merged')).toMatchObject({ kind: 'absent' })
})
