// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createMergeStageTool, createStaging, MERGE_STAGE_TOOL_NAME, StageToolRegistry, type StageToolContext } from '../src/index.ts'

const input = (runId: string) => ({
  runId, target: 'umbrella',
  sources: [{ name: 'a', body: '---\nname: a\ndescription: a\n---\n', files: [] }],
  promptVersion: 'p1', ttlDays: 7, now: () => 1000,
})

it('defines merge_stage and routes writes through applyStageTool', async () => {
  const home = await tempRoot('dsh-merge-tool-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  const ctx: StageToolContext = { runId: 'run-1', childId: 'child-1', expectedChildId: 'child-1', phase: 'author' }
  const tool = createMergeStageTool(io, home, () => ctx)
  expect(tool.name).toBe(MERGE_STAGE_TOOL_NAME)
  const written = JSON.parse(await tool.execute({ op: 'write', path: 'SKILL.md', content: 'target' }, {})) as { ok: boolean }
  expect(written.ok).toBe(true)
  const read = JSON.parse(await tool.execute({ op: 'read', area: 'merged', path: 'SKILL.md' }, {})) as { ok: boolean; value: string }
  expect(read).toMatchObject({ ok: true, value: 'target' })
})

it('limits the child to merge_stage and refuses writes in the decide phase', async () => {
  const home = await tempRoot('dsh-merge-tool-phase-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  const decide: StageToolContext = { runId: 'run-1', childId: 'child-1', expectedChildId: 'child-1', phase: 'decide' }
  const tool = createMergeStageTool(io, home, () => decide)
  expect(tool.name).toBe('merge_stage')
  expect(JSON.parse(await tool.execute({ op: 'write', path: 'SKILL.md', content: 'x' }, {}))).toMatchObject({ ok: false, code: 'phase' })
})

it('rejects bad shapes and wrong child without writing', async () => {
  const home = await tempRoot('dsh-merge-tool-guard-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  const ctx: StageToolContext = { runId: 'run-1', childId: 'other', expectedChildId: 'child-1', phase: 'author' }
  const tool = createMergeStageTool(io, home, () => ctx)
  expect(JSON.parse(await tool.execute({ op: 'read', area: 'merged' }, {}))).toMatchObject({ ok: false, code: 'bad-path' })
  expect(JSON.parse(await tool.execute({ op: 'write', path: 'SKILL.md', content: 'x' }, {}))).toMatchObject({ ok: false, code: 'not-merge-child' })
})

it('resolves the stage context from the tool exec child id', async () => {
  const home = await tempRoot('dsh-merge-tool-registry-')
  const io = nodeEvolutionIo()
  expect((await createStaging(io, home, input('run-1'))).ok).toBe(true)
  const registry = new StageToolRegistry()
  registry.bind('child-1', { runId: 'run-1', childId: 'child-1', expectedChildId: 'child-1', phase: 'author' })
  const tool = createMergeStageTool(io, home, exec => registry.resolve(exec))
  const exec = { agent: { session: { id: 'child-1' } } }
  expect(JSON.parse(await tool.execute({ op: 'write', path: 'SKILL.md', content: 'x' }, exec))).toMatchObject({ ok: true })
  registry.unbind('child-1')
  expect(JSON.parse(await tool.execute({ op: 'write', path: 'SKILL.md', content: 'y' }, exec))).toMatchObject({ ok: false, code: 'not-merge-child' })
})
