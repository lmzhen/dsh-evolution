// @tier pre-tag
// E2 (FR-RUN-03 / FR-EXEC-17 / NFR-04 / NFR-07): pair and scan answer E-305 without
// opening a run, an in-flight pair/target is refused naming its run, and every runtime
// failure keeps the three-line code/hint/next shape with the run id when one exists.
import { expect, it } from 'vitest'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { makeV4Home, v3Row } from './support/schema4-home.ts'
import { createMergeRuntime, pairKey, type MergeRuntimeDeps, type SkillCard } from '../src/index.ts'
import { writeRunMeta } from '../src/domain/run-coordinator.ts'
import { loadMergeState } from '../src/state.ts'

const DECISION = { shouldMerge: true as const, mode: 'merge-into-existing' as const, target: 'c', sources: ['a', 'b'], rationale: 'r' }
const lines = (text: string) => text.split('\n')

function registry(): MergeRuntimeDeps['registry'] & { began: string[] } {
  const began: string[] = []
  return {
    began,
    async begin(_kind, seed) { began.push(String(seed?.command)); return { id: 'run-new', signal: new AbortController().signal, startedAt: 1 } },
    async stage() {}, async settle() {},
  } as MergeRuntimeDeps['registry'] & { began: string[] }
}

const cards: SkillCard[] = [
  { name: 'a', description: 'a', body: 'body', managed: true },
  { name: 'b', description: 'b', body: 'body', managed: true },
  { name: 'c', description: 'c', body: 'body', managed: true },
]

function runtime(home: string, io: Awaited<ReturnType<typeof makeV4Home>>['io'], reg = registry(), override = cards): ReturnType<typeof createMergeRuntime> {
  const deps: MergeRuntimeDeps = {
    io, home, registry: reg, skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: true, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0,
    cards: async () => override, screeningForRun: async () => [],
  }
  return createMergeRuntime(deps)
}

it('pair and scan answer E-305 in three lines and start no run', async () => {
  const v4 = await makeV4Home([])
  const reg = registry()
  const service = runtime(v4.home, v4.io, reg)
  for (const command of [{ verb: 'pair', a: 'a', b: 'b' }, { verb: 'scan' }] as const) {
    const result = await service.execute(command as never, { agentless: true })
    expect(result.ok).toBe(false)
    expect(lines(result.text)).toHaveLength(3)
    expect(result.text).toContain('code: e-305')
    expect(result.text).toContain('hint: E-305')
    expect(result.text).toContain('next: ')
  }
  expect(reg.began).toEqual([])
})

it('rejects provider/name and provider:name skill syntax before opening a run', async () => {
  const v4 = await makeV4Home([])
  const reg = registry()
  const service = runtime(v4.home, v4.io, reg)
  for (const command of [{ verb: 'pair', a: 'provider/a', b: 'b' }, { verb: 'pair', a: 'a', b: 'provider:b' }] as const) {
    const result = await service.execute(command as never)
    expect(result.ok).toBe(false)
    expect(result.text).toContain('code: target-invalid')
  }
  expect(reg.began).toEqual([])
})

it('pair refuses a protected source before opening a run', async () => {
  const v4 = await makeV4Home([])
  const reg = registry()
  const service = runtime(v4.home, v4.io, reg, [{ ...cards[0]!, protectedBy: 'builtin' }, cards[1]!, cards[2]!])
  const result = await service.execute({ verb: 'pair', a: 'a', b: 'b' } as never)
  expect(result.text).toContain('code: pair-protected')
  expect(reg.began).toEqual([])
})

it('pair drops a skipped row for the same pair before scanning', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'skip-1', state: 'skipped', reason: 'rejected', skipSource: 'human' })])
  const service = runtime(v4.home, v4.io)
  await service.execute({ verb: 'pair', a: 'a', b: 'b' } as never)
  expect((await loadMergeState(v4.io, v4.home)).state.rows.some(row => row.id === 'skip-1')).toBe(false)
})

it('candidates --retry requires an existing verify row and starts no run on bad input', async () => {
  const v4 = await makeV4Home([])
  const reg = registry()
  const service = runtime(v4.home, v4.io, reg)
  const missingId = await service.execute({ verb: 'candidates', retry: true } as never)
  expect(missingId.text).toContain('code: candidates-id-required')
  const missingRow = await service.execute({ verb: 'candidates', retry: true, id: 'mr_missing' } as never)
  expect(missingRow.text).toContain('code: row-not-found')
  expect(reg.began).toEqual([])
})

it('a pair already in flight is refused with the owning run id, and no run opens', async () => {
  const v4 = await makeV4Home([])
  const io = v4.io
  await writeRunMeta(io, v4.home, { version: 1, runId: 'run-live', pairKey: pairKey('a', 'b'), pairCount: 1, phase: 'running', createdAt: 'x', updatedAt: 'x' })
  const reg = registry()
  const result = await runtime(v4.home, io, reg).execute({ verb: 'pair', a: 'a', b: 'b' })
  expect(result.ok).toBe(false)
  expect(result.text).toContain('code: merge-pair-in-flight')
  expect(result.text).toContain('run=run-live')
  expect(reg.began).toEqual([])
})

it('a settled run-meta for the same pair does not block a new pair', async () => {
  const v4 = await makeV4Home([])
  await writeRunMeta(v4.io, v4.home, { version: 1, runId: 'run-old', pairKey: pairKey('a', 'b'), pairCount: 1, phase: 'settled', createdAt: 'x', updatedAt: 'x' })
  const result = await runtime(v4.home, v4.io).execute({ verb: 'pair', a: 'a', b: 'b' })
  expect(result.ok).toBe(true)
  expect(result.text).toContain('已启动')
})

it('approve serialises on a target held by another run and names that run', async () => {
  const v4 = await makeV4Home([
    v3Row({ id: 'busy', state: 'fuse', target: 'c', decision: DECISION, runId: 'run-a', pairKey: 'a\u0000b' } as never),
    v3Row({ id: 'p1', state: 'pending', target: 'c', decision: DECISION, pairKey: 'a\u0000c' } as never),
  ])
  const result = await runtime(v4.home, v4.io).execute({ verb: 'approve', id: 'p1' })
  expect(result.ok).toBe(false)
  expect(result.text).toContain('code: merge-target-busy')
  expect(result.text).toContain('run=run-a')
})

it('resume serialises on a target held by another row and names that run', async () => {
  const v4 = await makeV4Home([
    v3Row({ id: 'f1', state: 'fuse', target: 'c', decision: DECISION, runId: 'run-f1', pairKey: 'a\u0000b' } as never),
    v3Row({ id: 'f2', a: 'd', b: 'e', pairKey: 'd\u0000e', state: 'fuse', target: 'c', decision: DECISION, runId: 'run-f2' } as never),
  ])
  const result = await runtime(v4.home, v4.io).execute({ verb: 'resume', id: 'f1' })
  expect(result.ok).toBe(false)
  expect(result.text).toContain('code: merge-target-busy')
  expect(result.text).toContain('run=run-f2')
})

it('row failures keep three lines and carry the row run id', async () => {
  const v4 = await makeV4Home([
    v3Row({ id: 's1', state: 'skipped', reason: 'kept', runId: 'run-s', pairKey: 'a\u0000b' } as never),
  ])
  const service = runtime(v4.home, v4.io)
  const cases = [
    await service.execute({ verb: 'reject', id: 's1' }),
    await service.execute({ verb: 'discard', id: 's1' }),
    await service.execute({ verb: 'resume', id: 's1' }),
  ]
  for (const result of cases) {
    expect(result.ok).toBe(false)
    expect(lines(result.text)).toHaveLength(3)
    expect(result.text.split('\n')[0]?.startsWith('code: ')).toBe(true)
    expect(result.text.split('\n')[1]?.startsWith('hint: ')).toBe(true)
    expect(result.text.split('\n')[2]?.startsWith('next: ')).toBe(true)
    expect(result.text).toContain('run=run-s')
  }
})
