// @tier pre-tag
import { expect, it } from 'vitest'
import type { SkillLibrary, RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { makeV4Home } from './support/schema4-home.ts'
import { createMergeRuntime, pairKey, type MergeRuntimeDeps } from '../src/index.ts'
import { recordPair } from '../src/domain/pair-index-store.ts'
import { readMergeSnapshot } from '../src/domain/merge-snapshot.ts'
import { buildRunDetail } from '../src/surface/merge-view.ts'

const run: RunRecord = { id: 'run-1', kind: 'merge', state: 'succeeded', startedAt: 1, command: 'approve', resultRef: '/tmp/report.json' }

it('CLI status consumes buildRunDetail with the current pair and per-pair outcomes', async () => {
  const v4 = await makeV4Home([])
  await recordPair(v4.io, v4.home, { pairKey: pairKey('alpha-skill', 'beta-skill'), runId: 'run-1', result: 'merged', target: 'umbrella' })
  const registry = {
    async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 1 } },
    async stage() {},
    async settle() {},
    runs() { return [run] },
    find(id: string) { return id === 'run-1' ? run : undefined },
    cancel() { return false },
    cancelAll() { return 0 },
  } as unknown as MergeRuntimeDeps['registry']
  const runtime = createMergeRuntime({
    io: v4.io, home: v4.home, registry, skills: {} as SkillLibrary, now: () => 2,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0, cards: async () => [], screeningForRun: async () => [],
  })
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [run], approval: false })
  const detail = buildRunDetail(snapshot, 'run-1')
  expect(detail?.currentPairKey).toBe(pairKey('alpha-skill', 'beta-skill'))
  expect(detail?.pairs[0]).toMatchObject({ a: 'alpha-skill', b: 'beta-skill', outcome: 'merged', target: { requested: 'umbrella' } })
  const answer = await runtime.execute({ verb: 'status', id: 'run-1' })
  expect(answer.ok).toBe(true)
  expect(answer.text).toContain('merge run run-1 [succeeded] command=approve')
  expect(answer.text).toContain('currentPair=alpha-skill + beta-skill')
  expect(answer.text).toContain('alpha-skill + beta-skill: merged target=umbrella')
  expect(answer.text).toContain('resultRef=/tmp/report.json')
})

it('status with an unknown id answers the three-line row-not-found error', async () => {
  const v4 = await makeV4Home([])
  const registry = { async begin() { throw new Error('unused') }, runs() { return [] }, find() { return undefined } } as unknown as MergeRuntimeDeps['registry']
  const runtime = createMergeRuntime({
    io: v4.io, home: v4.home, registry, skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0, cards: async () => [], screeningForRun: async () => [],
  })
  const answer = await runtime.execute({ verb: 'status', id: 'missing' })
  expect(answer.ok).toBe(false)
  expect(answer.text.split('\n')).toHaveLength(3)
  expect(answer.text).toContain('code: row-not-found')
})
