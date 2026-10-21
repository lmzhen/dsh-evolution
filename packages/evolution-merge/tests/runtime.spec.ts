// @tier pre-tag
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createMergeRuntime, loadMergeState, pairKey, rowIdOf, upsertRow, type MergeRow, type MergeRuntimeDeps } from '../src/index.ts'

it('serves read-only verbs through the runtime', async () => {
  const home = await tempRoot('dsh-merge-runtime-')
  const io = nodeEvolutionIo()
  const deps: MergeRuntimeDeps = {
    io, home, registry: { begin: async () => { throw new Error('not used') } } as unknown as MergeRuntimeDeps['registry'],
    skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel: { open: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0,
    cards: async () => [], screeningForRun: async () => [],
  }
  const runtime = createMergeRuntime(deps)
  expect(await runtime.execute({ verb: 'status' })).toMatchObject({ ok: true })
  expect(await runtime.execute({ verb: 'doctor' })).toMatchObject({ ok: true })
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
    parent: {}, allow: [], timeoutMinutes: 0, cards: async () => [], screeningForRun: async () => [],
  }
  const runtime = createMergeRuntime(deps)
  expect(await runtime.execute({ verb: 'report', id: 'r1' })).toEqual({ ok: true, text: '{"ok":true}' })
  expect(await runtime.execute({ verb: 'runs' })).toMatchObject({ ok: true })
  expect(await runtime.execute({ verb: 'cancel', id: 'r1' })).toMatchObject({ ok: true })
})

it('rejects a pending row into the skipped queue', async () => {
  const home = await tempRoot('dsh-merge-runtime-reject-')
  const io = nodeEvolutionIo()
  const key = pairKey('alpha-skill', 'beta-skill')
  const row: MergeRow = { id: rowIdOf(key), pairKey: key, a: 'alpha-skill', b: 'beta-skill', state: 'pending', queue: 'pending', createdAt: 'x', updatedAt: 'x' }
  await upsertRow(io, home, () => 1, row)
  const deps: MergeRuntimeDeps = {
    io, home, registry: {} as MergeRuntimeDeps['registry'], skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel: { open: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0, cards: async () => [], screeningForRun: async () => [],
  }
  const runtime = createMergeRuntime(deps)
  expect(await runtime.execute({ verb: 'reject', id: row.id })).toMatchObject({ ok: true })
  expect((await loadMergeState(io, home)).state.rows[0]).toMatchObject({ state: 'skipped', origin: 'human' })
})

it('restores a skipped row and clears a resume row', async () => {
  const home = await tempRoot('dsh-merge-runtime-clear-')
  const io = nodeEvolutionIo()
  const key = pairKey('alpha-skill', 'beta-skill')
  const row: MergeRow = { id: rowIdOf(key), pairKey: key, a: 'alpha-skill', b: 'beta-skill', state: 'skipped', queue: 'skipped', createdAt: 'x', updatedAt: 'x' }
  await upsertRow(io, home, () => 1, row)
  const deps: MergeRuntimeDeps = {
    io, home, registry: {} as MergeRuntimeDeps['registry'], skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel: { open: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable', code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0, cards: async () => [], screeningForRun: async () => [],
  }
  const runtime = createMergeRuntime(deps)
  expect(await runtime.execute({ verb: 'skipped', restore: row.id })).toMatchObject({ ok: true })
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
})
