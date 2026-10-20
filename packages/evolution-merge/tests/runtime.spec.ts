// @tier pre-tag
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
