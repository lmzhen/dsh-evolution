import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIo } from '@deepseek-ai/dsh-evolution-io'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import type { EvolutionStateStorage, PendingRecord } from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '@deepseek-ai/dsh-evolution-state-json'
import { jsonTransact } from '../src/index.ts'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'


describe('evolution-state-json jsonTransact record-map task-return guard (V4-08)', () => {
  it('rejects an array task return for a record-map file and writes nothing', async () => {
    const root = await tempRoot('dsh-json-guard-arr-')
    const ctx = await mountStateStack(root)
    const io = () => ctx.evolutionIo.provider('node')
    await expect(jsonTransact(ctx, io, root, 'pending-state.json', () => [])).rejects.toThrow(/task returned an array/)
    expect(await io().exists(join(root, 'pending-state.json'))).toBe(false)
  })

  it('rejects a scalar task return and leaves an existing record-map file unchanged', async () => {
    const root = await tempRoot('dsh-json-guard-scalar-')
    const ctx = await mountStateStack(root)
    const io = () => ctx.evolutionIo.provider('node')
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    const before = await io().readText(join(root, 'review-state.json'))
    await expect(jsonTransact(ctx, io, root, 'review-state.json', () => 42)).rejects.toThrow(/task returned number/)
    expect(await io().readText(join(root, 'review-state.json'))).toBe(before)
  })

  it('a null task return (ensure-absent) is allowed and persists no file', async () => {
    const root = await tempRoot('dsh-json-guard-null-')
    const ctx = await mountStateStack(root)
    const io = () => ctx.evolutionIo.provider('node')
    await expect(jsonTransact(ctx, io, root, 'pending-state.json', () => null)).resolves.toBeUndefined()
    expect(await io().exists(join(root, 'pending-state.json'))).toBe(false)
  })
})

const PENDING: PendingRecord = {
  id: 'p1', kind: 'memory', summary: 'memory:p1', args: {}, createdAt: 'now', status: 'pending',
}

/** The three void-returning seam saves, i.e. the write paths F-4 is about. */
const SAVES: Array<{ file: string; save: (provider: EvolutionStateStorage) => Promise<void> }> = [
  { file: 'review-state.json', save: p => p.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 }) },
  { file: 'curator-state.json', save: p => p.saveCuratorState({ lastRunAt: 1, runCount: 0, lastSummary: 'seed', paused: false }) },
  { file: 'pending-state.json', save: p => p.savePending(PENDING) },
]

/**
 * V43 F-4 (S0-6): mount the JSON state provider over an IO backend that
 * IMPLEMENTS `transact` but never invokes the task — the contract violation the
 * family's C-01 (memory-store) and V6-19 (skill-store) guards exist for. The
 * real node backend supplies every other method, so the save path runs for
 * real: only the transaction body is skipped.
 */
async function mountOverViolatingTransact(root: string): Promise<{ provider: EvolutionStateStorage; io: EvolutionIoLike }> {
  const io: EvolutionIo = { ...nodeEvolutionIo(), name: 'violating', transact: async () => {} }
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider(io, { default: true })
  await ctx.plugin(JsonState, { root })
  return { provider: ctx.evolutionStateStorage.provider('json'), io }
}

describe('evolution-state-json save* transact-task guard (V43 F-4 / S0-6)', () => {
  for (const { file, save } of SAVES) {
    it(`${file}: a transaction that never runs the task fails loud and writes nothing`, async () => {
      const root = await tempRoot('dsh-json-task-guard-')
      const { provider, io } = await mountOverViolatingTransact(root)
      await expect(save(provider)).rejects.toThrow(/did not invoke the task; no write was performed/)
      // The whole point of the guard: the failed write is OBSERVABLE and the
      // medium is exactly as it was (the record is nowhere, not silently lost).
      expect(await io.readText(join(root, file))).toBeNull()
      expect(await io.list(root)).toEqual([])
    })
  }

  it('all three saves still land through a working transaction (no false positive)', async () => {
    const root = await tempRoot('dsh-json-task-guard-ok-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    for (const { save } of SAVES) await expect(save(provider)).resolves.toBeUndefined()
    const review = JSON.parse((await io.readText(join(root, 'review-state.json')))!) as Record<string, { turnsSinceMemory: number }>
    expect(review['s1']?.turnsSinceMemory).toBe(1)
    const curator = JSON.parse((await io.readText(join(root, 'curator-state.json')))!) as Record<string, { lastSummary: string }>
    expect(curator['primary']?.lastSummary).toBe('seed')
    const pending = JSON.parse((await io.readText(join(root, 'pending-state.json')))!) as Record<string, PendingRecord>
    expect(pending['p1']?.id).toBe('p1')
    // A re-save whose serialized map is byte-identical to what is already on
    // disk is a DEDUPE no-op, not a skipped task: the guard must stay silent
    // (the probe answers "did the write path decide", not "did bytes move").
    await expect(provider.savePending(PENDING)).resolves.toBeUndefined()
    await expect(provider.saveCuratorState({ lastRunAt: 1, runCount: 0, lastSummary: 'seed', paused: false })).resolves.toBeUndefined()
  })
})

describe('evolution-state-json transactCuratorState transact-task guard (PLAN S3.2, 2026-09-16)', () => {
  it('a transaction that never runs the task fails loud and writes nothing', async () => {
    const root = await tempRoot('dsh-json-tc-guard-')
    const { provider, io } = await mountOverViolatingTransact(root)
    // PLAN S3.2: the fourth void write path joins the guard family — the task
    // runs INSIDE the jsonTransact callback, so a backend that implements
    // `transact` but skips the task used to resolve as a successful transact
    // with nothing applied (same silent-lost-write shape as V43 F-4).
    await expect(provider.transactCuratorState(() => ({ lastRunAt: 1, runCount: 0, lastSummary: 'transacted', paused: false })))
      .rejects.toThrow(/did not invoke the task; no write was performed/)
    // Same observability discipline as the three sibling saves: the failed
    // write is loud and the medium is exactly as it was.
    expect(await io.readText(join(root, 'curator-state.json'))).toBeNull()
    expect(await io.list(root)).toEqual([])
  })

  it('still lands through a working transaction, and a null task return stays silent (no false positive)', async () => {
    const root = await tempRoot('dsh-json-tc-guard-ok-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await expect(provider.transactCuratorState(current => ({ ...(current ?? { lastRunAt: 0, runCount: 0, lastSummary: '', paused: false }), runCount: (current?.runCount ?? 0) + 1 })))
      .resolves.toBeUndefined()
    const curator = JSON.parse((await io.readText(join(root, 'curator-state.json')))!) as Record<string, { runCount: number }>
    expect(curator['primary']?.runCount).toBe(1)
    // A null-returning task ("keep unchanged") DID run — the guard must stay
    // silent (it answers "did the write path get to decide", not "did the
    // record change"), exactly like the siblings' dedupe no-op.
    await expect(provider.transactCuratorState(() => null)).resolves.toBeUndefined()
  })
})
