// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { applyStageTool, createStaging, type StageToolContext } from '../src/index.ts'

const input = (runId: string) => ({
  runId,
  target: 'umbrella',
  sources: [{ name: 'a', body: 'body-a', files: [{ path: 'references/x.md', content: 'x' }] }],
  promptVersion: 'p1',
  ttlDays: 7,
  now: () => 1000,
})

const author = (childId = 'child-1'): StageToolContext => ({ runId: 'run-1', childId, expectedChildId: 'child-1', phase: 'author' })
const decide = (): StageToolContext => ({ runId: 'run-1', childId: 'child-1', expectedChildId: 'child-1', phase: 'decide' })

it('binds the child and phase, then reads/writes/copies the staged tree', async () => {
  const home = await tempRoot('dsh-merge-stage-tool-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect(await applyStageTool(io, home, author('other'), { op: 'write', path: 'SKILL.md', content: 'x' })).toMatchObject({ ok: false, code: 'not-merge-child' })
  expect(await applyStageTool(io, home, decide(), { op: 'write', path: 'SKILL.md', content: 'x' })).toMatchObject({ ok: false, code: 'phase' })
  expect(await applyStageTool(io, home, author(), { op: 'write', path: 'SKILL.md', content: 'target' })).toMatchObject({ ok: true })
  expect(await applyStageTool(io, home, author(), { op: 'read', area: 'merged', path: 'SKILL.md' })).toMatchObject({ ok: true, value: 'target' })
  expect(await applyStageTool(io, home, author(), { op: 'list', area: 'sources', source: 'a', path: 'references' })).toMatchObject({ ok: true, value: ['x.md'] })
  expect(await applyStageTool(io, home, author(), { op: 'copy', source: 'a', from: 'references/x.md', to: 'references/x.md' })).toMatchObject({ ok: true })
  expect(await applyStageTool(io, home, author(), { op: 'read', area: 'merged', path: 'references/x.md' })).toMatchObject({ ok: true, value: 'x' })
})

it('reports not-found for a missing staged file', async () => {
  const home = await tempRoot('dsh-merge-stage-tool-missing-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  expect(await applyStageTool(io, home, author(), { op: 'read', area: 'merged', path: 'missing.md' })).toMatchObject({ ok: false, code: 'not-found' })
})
