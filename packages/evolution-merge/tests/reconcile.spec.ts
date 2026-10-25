// @tier pre-tag
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, type SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { makeV4Home, v3Row } from './support/schema4-home.ts'
import { readPairLedgerV4 } from '../src/domain/pair-ledger.ts'
import { readReconcileReport, reconcileMergeState } from '../src/domain/reconcile.ts'
import { readMergeSnapshot } from '../src/domain/merge-snapshot.ts'
import { createStageTree, presentStage, readStageEntry, reserveStage, type StageEntry } from '../src/domain/stage-aggregate.ts'
import { mergeStatePath } from '../src/state.ts'
import { buildDoctorView } from '../src/surface/merge-view.ts'
import { mergeDoctor, mergeDoctorFact } from '../src/doctor.ts'
import { createMergeRuntime, type MergeRuntimeDeps } from '../src/index.ts'

const DECISION = { shouldMerge: true as const, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }
const stage = (rowId: string, state: StageEntry['state'], expiresAt: number): StageEntry => ({ version: 1, rowId, pairKey: 'a\u0000b', ref: 'run/pairs/' + rowId, state, createdAt: 1, expiresAt, updatedAt: 1 })

it('snapshot derives an expired stage without persisting it', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'f1', state: 'fuse', target: 'a', decision: DECISION } as never)])
  const entry = stage('f1', 'present', 1_000)
  await createStageTree(v4.io, v4.home, { runId: entry.ref, target: 'a', sources: [{ name: 'a', body: 'a', files: [] }], promptVersion: 'v', ttlDays: 1, now: () => 1 })
  await presentStage(v4.io, v4.home, entry)
  const before = await readFile(join(v4.home, 'merge', 'staging-index', 'f1.json'), 'utf8')
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: false, now: () => 2_000 })
  expect(snapshot.rows[0]?.stage?.state).toBe('expired')
  expect(await readFile(join(v4.home, 'merge', 'staging-index', 'f1.json'), 'utf8')).toBe(before)
  expect((await readStageEntry(v4.io, v4.home, 'f1'))?.state).toBe('present')
})

it('reconcile expires skipped rows once and persists its report', async () => {
  const v4 = await makeV4Home([v3Row({ id: 's1', state: 'skipped', reason: 'kept', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } as never)])
  const now = 10 * 86_400_000
  const first = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => now, ttlDays: 1 })
  expect(first.actions.map(action => action.code)).toEqual(['skipped-ttl'])
  expect((await readPairLedgerV4(v4.io, v4.home))?.rows[0]).toMatchObject({ state: 'skipped', expiredAt: now })
  const second = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => now, ttlDays: 1 })
  expect(second.actions).toEqual([])
  expect((await readReconcileReport(v4.io, v4.home))?.actions).toEqual([])
})

it('reconcile continues a usable approved stage and promotes the reserved index', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'r1', state: 'approved', target: 'a', decision: DECISION } as never)])
  const entry = stage('r1', 'reserved', Date.now() + 1_000_000)
  await createStageTree(v4.io, v4.home, { runId: entry.ref, target: 'a', sources: [{ name: 'a', body: 'body', files: [] }], promptVersion: 'x', ttlDays: 7, now: () => 1 })
  await reserveStage(v4.io, v4.home, entry)
  const report = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => Date.now(), ttlDays: 0 })
  expect(report.actions).toMatchObject([{ kind: 'approved-fused', rowId: 'r1', from: 'approved', to: 'fuse', code: 'stage-present' }])
  expect((await readPairLedgerV4(v4.io, v4.home))?.rows[0]?.state).toBe('fuse')
  expect((await readStageEntry(v4.io, v4.home, 'r1'))?.state).toBe('present')
})

it('reconcile turns a lost approved stage into a retryable fuse row', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'r2', state: 'approved', target: 'a', decision: DECISION } as never)])
  const report = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => Date.now(), ttlDays: 0 })
  expect(report.actions).toMatchObject([{ kind: 'approved-fused', rowId: 'r2', to: 'fuse', code: 'stage-lost' }])
  const row = (await readPairLedgerV4(v4.io, v4.home))?.rows[0]
  expect(row?.state).toBe('fuse')
  expect(row !== undefined && 'failure' in row ? row.failure?.code : undefined).toBe('stage-lost')
})

it('reconcile clears active rows whose sources are gone only when the live library is supplied', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p1', state: 'pending', target: 'a', decision: DECISION } as never)])
  const untouched = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => 1, ttlDays: 0 })
  expect(untouched.actions).toEqual([])
  expect((await readPairLedgerV4(v4.io, v4.home))?.rows).toHaveLength(1)
  const converged = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => 2, ttlDays: 0, managed: new Set(['a']) })
  expect(converged.actions).toMatchObject([{ kind: 'source-gone', rowId: 'p1', to: 'removed', code: 'source-gone' }])
  expect((await readPairLedgerV4(v4.io, v4.home))?.rows).toEqual([])
})

it('a blocked state is reported and writes nothing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-reconcile-blocked-'))
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const raw = JSON.stringify({ schemaVersion: 3, rows: [] })
  await writeFile(mergeStatePath(home), raw)
  const report = await reconcileMergeState({ io, home, now: () => 1, ttlDays: 0 })
  expect(report.state).toBe('blocked')
  expect(report.actions).toEqual([])
  expect(await readFile(mergeStatePath(home), 'utf8')).toBe(raw)
  expect(await readReconcileReport(io, home)).toBeNull()
  const view = buildDoctorView(await readMergeSnapshot({ io, home, runs: [], approval: false }))
  expect(view.blocked?.code).toBe('merge-state-normalize-required')
  expect(mergeDoctorFact(view, null).status).toBe('fail')
})

it('the global doctor fact consumes buildDoctorView plus the reconcile report', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'f2', state: 'fuse', target: 'a', decision: DECISION } as never)])
  const entry = stage('f2', 'present', Date.now() + 1_000_000)
  await createStageTree(v4.io, v4.home, { runId: entry.ref, target: 'a', sources: [{ name: 'a', body: 'a', files: [] }], promptVersion: 'v', ttlDays: 7, now: () => 1 })
  await presentStage(v4.io, v4.home, entry)
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: false })
  const healthy = mergeDoctorFact(buildDoctorView(snapshot), null)
  expect(healthy.status).toBe('ok')
  expect(healthy.detail).toContain('fuse 1')
  expect(healthy.detail).toContain('reconcile 尚未运行')
  const blocked = mergeDoctorFact(buildDoctorView(snapshot), { version: 1, at: 1, state: 'blocked', code: 'merge-state-needs-repair', message: 'x', actions: [], notes: [] })
  expect(blocked.status).toBe('fail')
  expect(blocked.detail).toContain('reconcile blocked')
  expect(blocked.remedy).toContain('/evolution merge reconcile')
})
it('CLI reconcile runs the writer and the doctor consumes its report', async () => {
  const v4 = await makeV4Home([v3Row({ id: 's2', state: 'skipped', reason: 'kept', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } as never)])
  const registry = { async begin() { throw new Error('unused') }, runs() { return [] }, find() { return undefined }, cancel() { return false } } as unknown as MergeRuntimeDeps['registry']
  const runtime = createMergeRuntime({
    io: v4.io, home: v4.home, registry, skills: {} as SkillLibrary, now: () => 10 * 86_400_000,
    params: { mergeApproval: false, mergeSkippedTtlDays: 1, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0, cards: async () => [], screeningForRun: async () => [],
  })
  const answer = await runtime.execute({ verb: 'reconcile' })
  expect(answer.ok, answer.text).toBe(true)
  expect(answer.text).toContain('merge reconcile: skipped-expired 1')
  const doctor = (await mergeDoctor(v4.io, v4.home)).find(row => row.key === 'reconcile')
  expect(doctor?.status).toBe('warn')
  expect(doctor?.detail).toContain('skipped-ttl')
})

it('an empty library never authorizes source-gone removal', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p2', state: 'pending', target: 'a', decision: DECISION } as never)])
  const registry = { async begin() { throw new Error('unused') }, runs() { return [] }, find() { return undefined }, cancel() { return false } } as unknown as MergeRuntimeDeps['registry']
  const runtime = createMergeRuntime({
    io: v4.io, home: v4.home, registry, skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: false, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0, cards: async () => [], screeningForRun: async () => [],
  })
  expect((await runtime.execute({ verb: 'reconcile' })).ok).toBe(true)
  expect((await readPairLedgerV4(v4.io, v4.home))?.rows).toHaveLength(1)
})
