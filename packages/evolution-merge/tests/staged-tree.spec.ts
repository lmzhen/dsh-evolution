// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createStaging, readStagedTree, writeStagedFile } from '../src/index.ts'

const input = (runId: string) => ({
  runId,
  target: 'umbrella',
  sources: [{ name: 'a', body: 'body-a', files: [] }],
  promptVersion: 'p1',
  ttlDays: 7,
  now: () => 1000,
})

it('reads the merged tree as the commit source', async () => {
  const home = await tempRoot('dsh-merge-staged-tree-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'SKILL.md', '---\nname: umbrella\ndescription: d\n---\n\nbody')).ok).toBe(true)
  expect((await writeStagedFile(io, home, 'run-1', 'references/x.md', 'x')).ok).toBe(true)
  const tree = await readStagedTree(io, home, 'run-1')
  expect(tree).toMatchObject({ kind: 'present', value: { target: 'umbrella' } })
  if (tree.kind !== 'present') return
  expect(tree.value.body).toContain('body')
  expect(tree.value.files).toEqual([{ path: 'references/x.md', content: 'x' }])
})

it('reports absent and missing SKILL.md distinctly', async () => {
  const home = await tempRoot('dsh-merge-staged-tree-probe-')
  const io = nodeEvolutionIo()
  expect(await readStagedTree(io, home, 'missing')).toEqual({ kind: 'absent' })
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect((await readStagedTree(io, home, 'run-1')).kind).toBe('unknown')
})
