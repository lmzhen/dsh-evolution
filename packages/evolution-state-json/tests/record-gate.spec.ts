import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'

async function mount(root: string) {
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root })
  return ctx
}

describe('V10-04 (P2-19): json provider per-record field gates', () => {
  it('isolates a record with a wrong field shape and keeps the valid siblings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-gate-review-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    // The audit's exact case: `{"s1":{"foo":1}}` used to load as a
    // ReviewStateRecord and turnsSinceMemory became NaN downstream. Now s1 is
    // quarantined (fixed `.corrupt` copy) and EXCLUDED, while s2 survives.
    const valid = { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 }
    const content = JSON.stringify({ s1: { foo: 1 }, s2: valid })
    await io.writeText(join(root, 'review-state.json'), content)
    expect(await provider.loadReviewState('s1')).toBeNull()
    expect(await provider.loadReviewState('s2')).toEqual(valid)
    // Isolated, not silently skipped: the fixed `.corrupt` copy holds the
    // failing record(s) only, and the source file is left untouched for
    // operator rescue.
    const corrupt = await io.readText(join(root, 'review-state.json.corrupt'))
    expect(corrupt).not.toBeNull()
    expect(JSON.parse(corrupt!)).toEqual({ s1: { foo: 1 } })
    expect(await io.readText(join(root, 'review-state.json'))).toBe(content)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('isolates a non-enum `status:"Pending"` record instead of leaving a permanent zombie', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-gate-status-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    // The audit's zombie case: `status:"Pending"` matched no query and was
    // invisible forever. It is now quarantined — visible as a rescue target —
    // rather than silently skipped on every read.
    const zombie = { id: 'z1', kind: 'memory', summary: 'zombie', args: {}, createdAt: 'now', status: 'Pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify({ z1: zombie }))
    expect(await provider.listPending()).toEqual([])
    expect(await provider.listPending('approved')).toEqual([])
    const corrupt = await io.readText(join(root, 'pending-state.json.corrupt'))
    expect(corrupt).not.toBeNull()
    expect(JSON.parse(corrupt!)).toEqual({ z1: zombie })
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('isolates a malformed curator record and keeps the singleton readable afterwards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-gate-curator-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'curator-state.json'), JSON.stringify({
      primary: { lastRunAt: 'not-a-number', runCount: 1, lastSummary: 'x', paused: false },
    }))
    expect(await provider.loadCuratorState()).toBeNull()
    expect(await io.readText(join(root, 'curator-state.json.corrupt'))).not.toBeNull()
    // The next save still works (the gate rewrote the state file with the bad
    // record dropped and the record becomes readable again).
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 1, lastSummary: 'ok', paused: false })
    expect((await provider.loadCuratorState())?.lastSummary).toBe('ok')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('gates the legacy pending.json merge too', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-gate-legacy-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      bad: { id: 'bad', kind: 'memory', summary: 'x', args: {}, createdAt: 'old', status: 'weird' },
      good: { id: 'good', kind: 'skill', summary: 'y', args: {}, createdAt: 'old', status: 'pending' },
    }))
    const pending = await provider.listPending('pending')
    expect(pending.map(record => record.id)).toEqual(['good'])
    expect(await io.readText(join(root, 'pending.json.corrupt'))).not.toBeNull()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('keeps well-formed records fully unaffected (no false isolation)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-gate-clean-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveReviewState('s1', { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: 0 })
    await provider.saveCuratorState({ lastRunAt: 0, runCount: 0, lastSummary: '', paused: false })
    await provider.savePending({ id: 'p1', kind: 'capability', summary: 's', args: { a: 1 }, createdAt: 'now', status: 'pending' })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: 0 })
    expect(await provider.loadCuratorState()).toEqual({ lastRunAt: 0, runCount: 0, lastSummary: '', paused: false })
    expect(await provider.listPending()).toHaveLength(1)
    // No quarantine copies anywhere — a clean store stays clean.
    const io = ctx.evolutionIo.provider('node')
    expect((await io.list(root)).filter(name => name.includes('.corrupt'))).toEqual([])
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('N12 (v12): rebuilds a .corrupt copy swept by the 7-day cleanup in the same process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-gate-n12-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    const zombie = { id: 'z1', kind: 'memory', summary: 'zombie', args: {}, createdAt: 'now', status: 'Pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify({ z1: zombie }))
    expect(await provider.listPending()).toEqual([])
    const corruptPath = join(root, 'pending-state.json.corrupt')
    expect(await io.readText(corruptPath)).not.toBeNull()
    // The sweep (io.ts S-10) removed the copy after its 7-day window; the
    // rewrite key alone used to suppress the rebuild until a restart — the
    // copy must come back on the next access.
    await rm(corruptPath, { force: true })
    expect(await provider.listPending()).toEqual([])
    expect(await io.readText(corruptPath)).not.toBeNull()
    expect(JSON.parse((await io.readText(corruptPath))!)).toEqual({ z1: zombie })
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('N2 (v13): a failed .corrupt write is RETRIED on the next read — the rewrite key is not set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-gate-n2-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    const zombie = { id: 'z1', kind: 'memory', summary: 'zombie', args: {}, createdAt: 'now', status: 'Pending' }
    let writes = 0
    ctx.provide('evolutionIo', {
      provider: () => ({
        readText: async () => JSON.stringify({ z1: zombie }),
        writeText: async () => { writes += 1; throw new Error('disk full') },
        exists: async () => false,
        list: async () => [],
        remove: async () => {},
        rename: async () => {},
        copy: async () => {},
      }),
    })
    await ctx.plugin(JsonState, { root })
    const provider = ctx.evolutionStateStorage.provider('json')
    expect(await provider.listPending()).toEqual([])
    const writesAfterFirst = writes
    await provider.listPending()
    // Before N2: a failed write still set the rewrite key, so the second read
    // skipped the copy and the write count stayed flat. The key must remain
    // unset so every read retries (red-to-green discriminator; the absolute
    // count is layout-dependent — listPending touches several record maps).
    expect(writes).toBeGreaterThan(writesAfterFirst)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('P2-1 (v13): a whole-file quarantine overwrite must let the record gate rewrite its scoped copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-gate-p21-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    const zombie = { id: 'z1', kind: 'memory', summary: 'zombie', args: {}, createdAt: 'now', status: 'Pending' }
    const corruptPath = join(root, 'pending-state.json.corrupt')
    // ① record gate writes the SCOPED copy (key K = {z1}).
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify({ z1: zombie }))
    await provider.listPending()
    expect(JSON.parse((await io.readText(corruptPath))!)).toEqual({ z1: zombie })
    // ② the file turns fully corrupt — quarantine overwrites the SAME copy
    // with the whole-file snapshot (key K stays unless invalidated, P2-1).
    await io.writeText(join(root, 'pending-state.json'), '{corrupt')
    await expect(provider.listPending()).rejects.toThrow()
    expect(await io.readText(corruptPath)).toBe('{corrupt')
    // ③ the operator fixes the JSON; the failing set is the same — the gate
    // must REWRITE the scoped copy, not trust the stale key+on-disk pair.
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify({ z1: zombie }))
    await provider.listPending()
    expect(JSON.parse((await io.readText(corruptPath))!)).toEqual({ z1: zombie })
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('P2-1 (v14): the write-back clears the same field gate — a malformed record never lands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-write-gate-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    // The same zombie record the READ gate quarantines: before v14 the write
    // path only checked the top-level map shape, so this landed on disk and
    // disappeared (quarantined + excluded) on the next read — the silent loss
    // window. The domain provider rejects it at put time; json now matches.
    const zombie = { id: 'z1', kind: 'memory', summary: 'zombie', args: {}, createdAt: 'now', status: 'Pending' } as unknown as Parameters<typeof provider.savePending>[0]
    await expect(provider.savePending(zombie)).rejects.toThrow(/field gate/)
    expect(await io.readText(join(root, 'pending-state.json'))).toBeNull()
    expect(await io.readText(join(root, 'pending-state.json.corrupt'))).toBeNull()
    // A well-formed record still lands, and a legacy write-back keeps working.
    await provider.savePending({ id: 'p2', kind: 'memory', summary: 'ok', args: {}, createdAt: 'now', status: 'pending' })
    expect((await provider.listPending()).map(record => record.id)).toEqual(['p2'])
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
