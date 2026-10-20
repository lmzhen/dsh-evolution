// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createStaging, readStaging, stagingRoot } from '../src/index.ts'

const input = (runId: string) => ({
  runId,
  target: 'umbrella',
  sources: [
    { name: 'a', body: '---\nname: a\ndescription: a\n---\n\n# a\n', files: [{ path: 'references/x.md', content: 'x' }] },
    { name: 'b', body: '---\nname: b\ndescription: b\n---\n\n# b\n', files: [] },
  ],
  promptVersion: 'p1',
  ttlDays: 7,
  now: () => 1000,
})

it('creates a staged run tree and reads it back', async () => {
  const home = await tempRoot('dsh-merge-staging-')
  const io = nodeEvolutionIo()
  const created = await createStaging(io, home, input('run-1'))
  expect(created.ok, created.ok ? '' : created.message).toBe(true)
  if (!created.ok) return
  expect(created.path).toBe(stagingRoot(home, 'run-1'))
  expect(await io.readText(created.path + '/sources/a/references/x.md')).toBe('x')
  expect(await io.readText(created.path + '/.stage')).toBe('')
  const loaded = await readStaging(io, home, 'run-1')
  expect(loaded).toMatchObject({ kind: 'present', value: { manifest: { runId: 'run-1', target: 'umbrella', sources: ['a', 'b'] } } })
})

it('refuses duplicates/unsafe paths and distinguishes absent from half-created', async () => {
  const home = await tempRoot('dsh-merge-staging-guard-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(false)
  const unsafe = { ...input('run-2'), sources: [{ name: 'a', body: 'x', files: [{ path: '../x', content: 'x' }] }] }
  expect((await createStaging(io, home, unsafe)).ok).toBe(false)
  expect(await readStaging(io, home, 'missing')).toEqual({ kind: 'absent' })
  await io.writeText(stagingRoot(home, 'half') + '/manifest.json', '{}')
  expect((await readStaging(io, home, 'half')).kind).toBe('unknown')
})
