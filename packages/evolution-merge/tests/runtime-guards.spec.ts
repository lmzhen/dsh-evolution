// @tier pre-tag
// E2 (FR-RUN-03 / FR-EXEC-17 / NFR-04 / NFR-07): pair and scan answer E-305 without
// opening a run, an in-flight pair/target is refused naming its run, and every runtime
// failure keeps the three-line code/hint/next shape with the run id when one exists.
import { readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { makeV4Home, v3Row } from './support/schema4-home.ts'
import { createMergeRuntime, pairKey, type MergeRuntimeDeps, type SkillCard } from '../src/index.ts'
import { writeRunMeta } from '../src/domain/run-coordinator.ts'
import { loadMergeState, mergeStatePath } from '../src/state.ts'

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

function runtime(home: string, io: Awaited<ReturnType<typeof makeV4Home>>['io'], reg = registry(), override = cards, isBlocked?: (name: string) => boolean | Promise<boolean>): ReturnType<typeof createMergeRuntime> {
  const deps: MergeRuntimeDeps = {
    io, home, registry: reg, skills: {} as SkillLibrary, now: () => 1,
    ...(isBlocked === undefined ? {} : { isBlocked }),
    params: { mergeApproval: true, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0,
    cards: async () => override, screeningForRun: async () => [],
  }
  return createMergeRuntime(deps)
}

it('pair refuses the same source twice before opening a run', async () => {
  const v4 = await makeV4Home([])
  const reg = registry()
  const service = runtime(v4.home, v4.io, reg)
  const result = await service.execute({ verb: 'pair', a: 'a', b: 'a' })
  expect(result.ok).toBe(false)
  expect(result.text).toContain('pair-same-source')
  expect(reg.began).toEqual([])
})

it('passes merge_stage as the only child allow-list entry', async () => {
  const v4 = await makeV4Home([])
  const opened: unknown[] = []
  const channel = {
    open: async (args: unknown) => { opened.push(args); return { kind: 'unavailable' as const, code: 'x', reason: 'x' } },
    continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }),
    dispose: async () => {},
  }
  const deps: MergeRuntimeDeps = {
    io: v4.io, home: v4.home, registry: registry(), skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel, parent: {}, allow: ['merge_stage'], timeoutMinutes: 0, detached: false,
    cards: async () => cards, screeningForRun: async () => [],
  }
  const service = createMergeRuntime(deps)
  const result = await service.execute({ verb: 'pair', a: 'a', b: 'b' })
  expect(opened[0]).toMatchObject({ allow: ['merge_stage'] })
})

it('pair --force writes the forced decision without round 1', async () => {
  const v4 = await makeV4Home([])
  const opened: unknown[] = []
  const deps: MergeRuntimeDeps = {
    io: v4.io, home: v4.home, registry: registry(), skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async (args: unknown) => { opened.push(args); return { kind: 'unavailable' as const, code: 'x', reason: 'x' } }, continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: ['merge_stage'], timeoutMinutes: 0, detached: false,
    cards: async () => cards, screeningForRun: async () => [],
  }
  const service = createMergeRuntime(deps)
  await service.execute({ verb: 'pair', a: 'a', b: 'b', force: true })
  const rows = (await loadMergeState(v4.io, v4.home)).state.rows
  expect(rows.some(row => row.decision?.target === 'merge-a-b')).toBe(true)
})

it('pair --force with approval yields a pending row with readable summaries', async () => {
  const v4 = await makeV4Home([])
  const deps: MergeRuntimeDeps = {
    io: v4.io, home: v4.home, registry: registry(), skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: true, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: ['merge_stage'], timeoutMinutes: 0, detached: false,
    cards: async () => cards, screeningForRun: async () => [],
  }
  const service = createMergeRuntime(deps)
  await service.execute({ verb: 'pair', a: 'a', b: 'b', force: true })
  const row = (await loadMergeState(v4.io, v4.home)).state.rows.find(item => item.decision?.target === 'merge-a-b')
  expect(row?.state).toBe('pending')
  expect(row?.decision?.aSummary?.length ?? 0).toBeGreaterThan(0)
  expect(row?.decision?.bSummary?.length ?? 0).toBeGreaterThan(0)
  expect(row?.decision?.rationale?.length ?? 0).toBeGreaterThan(0)
})

it('candidates --retry reruns round 1 for a verify row', async () => {
  const home = await makeV4Home([])
  await loadMergeState(home.io, home.home)
  const path = mergeStatePath(home.home)
  const state = JSON.parse(await readFile(path, 'utf8')) as { rows: unknown[] }
  state.rows.push({ id: 'v1', pairKey: 'a\u0000b', a: 'a', b: 'b', version: 1, createdAt: 'c', updatedAt: 'u', origin: 'agent', state: 'verify', verifySubState: 'unverified', attempts: 0 })
  await writeFile(path, JSON.stringify(state))
  const channel = {
    open: async () => ({ kind: 'ok' as const, childId: 'child-1', turn: { text: 'standby', stopReason: 'completed' } }),
    continueTurn: async () => ({ kind: 'ok' as const, childId: 'child-1', turn: { text: JSON.stringify(DECISION), stopReason: 'completed' } }),
    dispose: async () => {},
  }
  const deps: MergeRuntimeDeps = {
    io: home.io, home: home.home, registry: registry(), skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: true, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false, channel, parent: {}, allow: ['merge_stage'], timeoutMinutes: 0, detached: false,
    cards: async () => cards, screeningForRun: async () => [],
  }
  const service = createMergeRuntime(deps)
  const result = await service.execute({ verb: 'candidates', id: 'v1', retry: true })
  expect(result.ok, result.text).toBe(true)
  expect(result.text).toContain('candidates --retry 完成')
})

it('resume --retry enters the approved-row authoring path without a new approval', async () => {
  const home = await makeV4Home([])
  await loadMergeState(home.io, home.home)
  const path = mergeStatePath(home.home)
  const state = JSON.parse(await readFile(path, 'utf8')) as { rows: unknown[] }
  state.rows.push({ id: 'r1', pairKey: 'a\u0000b', a: 'a', b: 'b', version: 1, createdAt: 'c', updatedAt: 'u', origin: 'agent', state: 'approved', target: 'c', decision: DECISION, runId: 'run-old', attempts: 0 })
  await writeFile(path, JSON.stringify(state))
  const opened: unknown[] = []
  const deps: MergeRuntimeDeps = {
    io: home.io, home: home.home, registry: registry(), skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: true, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async (args: unknown) => { opened.push(args); return { kind: 'unavailable' as const, code: 'x', reason: 'x' } }, continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: ['merge_stage'], timeoutMinutes: 0, detached: false,
    cards: async () => cards, screeningForRun: async () => [],
  }
  const service = createMergeRuntime(deps)
  const result = await service.execute({ verb: 'resume', id: 'r1', retry: true })
  expect(result.text).not.toContain('row-not-found')
  expect(opened.length).toBeGreaterThan(0)
})

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
    expect(result.text).toContain('provider-conflict')
    expect(result.text.split('\n')).toHaveLength(2)
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

it('pair refuses a curator-blocked name before opening a run', async () => {
  const v4 = await makeV4Home([])
  const reg = registry()
  const service = runtime(v4.home, v4.io, reg, cards, name => name === 'a')
  const pairResult = await service.execute({ verb: 'pair', a: 'a', b: 'b' } as never)
  expect(pairResult.text).toContain('code: pair-blocked')
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
  expect(result.ok).toBe(true)
  expect(result.text).toContain('已在运行：run-live')
  expect(result.text).toContain('作用域：family-managed')
  expect(reg.began).toEqual([])
})

it('a stale run-meta whose owner is dead does not block a new pair', async () => {
  const v4 = await makeV4Home([])
  await writeRunMeta(v4.io, v4.home, { version: 1, runId: 'run-dead', pairKey: pairKey('a', 'b'), pairCount: 1, phase: 'running', pid: 999_999, createdAt: 'x', updatedAt: 'x' } as never)
  const result = await runtime(v4.home, v4.io).execute({ verb: 'pair', a: 'a', b: 'b' })
  expect(result.ok).toBe(true)
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
