// @tier pre-tag
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createMergeRuntime, type MergeRuntimeDeps } from '../src/index.ts'

it('serves read-only verbs through the runtime', async () => {
  const home = await tempRoot('dsh-merge-runtime-')
  const io = nodeEvolutionIo()
  const deps: MergeRuntimeDeps = {
    io, home, registry: { begin: async () => { throw new Error('not used') } } as unknown as MergeRuntimeDeps['registry'],
    skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel: { open: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0,
    cards: async () => [], screening: async () => [],
  }
  const runtime = createMergeRuntime(deps)
  expect(await runtime.execute({ verb: 'status' })).toMatchObject({ ok: true })
  expect((await runtime.execute({ verb: 'resume', id: 'mr_x' })).ok).toBe(false)
})

it('serves report/runs/cancel from the run registry', async () => {
  const home = await tempRoot('dsh-merge-runtime-report-')
  const io = nodeEvolutionIo()
  const report = join(home, 'report.json')
  await io.writeText(report, '{"ok":true}')
  const record = { id: 'r1', kind: 'merge' as const, state: 'succeeded' as const, startedAt: 1, resultRef: report }
  const registry = {
    runs: () => [record], find: (id: string) => id === 'r1' ? record : undefined,
    cancel: () => true, cancelAll: () => 1,
  } as unknown as MergeRuntimeDeps['registry']
  const deps: MergeRuntimeDeps = {
    io, home, registry, skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel: { open: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0, cards: async () => [], screening: async () => [],
  }
  const runtime = createMergeRuntime(deps)
  expect(await runtime.execute({ verb: 'report', id: 'r1' })).toEqual({ ok: true, text: '{"ok":true}' })
  expect(await runtime.execute({ verb: 'runs' })).toMatchObject({ ok: true })
  expect(await runtime.execute({ verb: 'cancel', id: 'r1' })).toMatchObject({ ok: true })
})
