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

describe('evolution-state-json boundaries', () => {
  it('quarantines malformed state files and fails loud instead of wiping them (E-9, 0.3.17)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-boundary-'))
    const ctx = await mount(root)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'review-state.json'), '{not-json')
    await expect(ctx.evolutionStateStorage.provider('json').loadReviewState('s1')).rejects.toThrow(/not valid JSON/)
    // The original bytes are preserved for operator rescue — never overwritten
    // as an empty map (the old contract silently cleared every other record).
    const entries = await io.list(root)
    const corrupt = entries.find(name => name.startsWith('review-state.json.corrupt-'))
    expect(corrupt).toBeDefined()
    expect(await io.readText(join(root, corrupt!))).toBe('{not-json')
    await rm(root, { recursive: true, force: true })
  })

  it('a save into a corrupt state file rejects and leaves the file untouched (E-9, 0.3.17)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-boundary2-'))
    const ctx = await mount(root)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'pending-state.json'), '{"p1": ')
    const provider = ctx.evolutionStateStorage.provider('json')
    await expect(provider.savePending({
      id: 'p2', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'pending',
    })).rejects.toThrow(/not valid JSON/)
    expect(await io.readText(join(root, 'pending-state.json'))).toBe('{"p1": ')
    await rm(root, { recursive: true, force: true })
  })

  it('claim moves the record to executing; resolve-from-executing and release-to-pending work (S3.3, E-24)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-s3-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    const claimed = await provider.claimPending('p1', 'c1')
    expect(claimed?.status).toBe('executing')
    // Nobody can re-claim (a crashed approve cannot double-execute).
    expect(await provider.claimPending('p1', 'c2')).toBeNull()
    // Resolving from executing is legal (operator or the same approve).
    const resolved = await provider.tryResolvePending('p1', 'rejected')
    expect(resolved.applied).toBe(true)
    // Fresh record: claim → RELEASE rolls executing back to pending (retryable).
    await provider.savePending({ id: 'p2', kind: 'skill', summary: 'y', args: {}, createdAt: 'now', status: 'pending' })
    await provider.claimPending('p2', 'c1')
    await provider.releasePendingClaim('p2', 'c1')
    expect((await provider.listPending('pending')).find(r => r.id === 'p2')?.claimedBy).toBeUndefined()
    expect((await provider.listPending('pending')).find(r => r.id === 'p2')?.status).toBe('pending')
    await rm(root, { recursive: true, force: true })
  })

  it('reads the legacy pending.json audit file for upgrade continuity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-legacy-'))
    const ctx = await mount(root)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      p1: { id: 'p1', kind: 'memory', summary: 'legacy', args: {}, createdAt: 'old', status: 'pending' },
    }))
    const pending = await ctx.evolutionStateStorage.provider('json').listPending('pending')
    expect(pending.map(record => record.id)).toEqual(['p1'])
    await rm(root, { recursive: true, force: true })
  })

  it('keeps legacy pending records visible when a new record is saved and can resolve them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-legacy-merge-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      legacy: { id: 'legacy', kind: 'memory', summary: 'legacy', args: {}, createdAt: 'old', status: 'pending' },
    }))
    await provider.savePending({ id: 'new', kind: 'skill', summary: 'new', args: {}, createdAt: 'now', status: 'pending' })
    expect((await provider.listPending('pending')).map(record => record.id).sort()).toEqual(['legacy', 'new'])

    const first = await provider.tryResolvePending('legacy', 'approved')
    expect(first.applied).toBe(true)
    const second = await provider.tryResolvePending('legacy', 'approved')
    expect(second.applied).toBe(false)
    expect(await provider.listPending('approved')).toHaveLength(1)
    expect(await provider.listPending('pending')).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })

  it('serializes concurrent state writes without lost updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-concurrent-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await Promise.all([
      provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 }),
      provider.saveReviewState('s2', { turnsSinceMemory: 2, turnsSinceSkill: 0, lastTurn: 2 }),
      provider.saveCuratorState({ lastRunAt: 1, runCount: 1, lastSummary: 'a', paused: false }),
      provider.saveCuratorState({ lastRunAt: 2, runCount: 2, lastSummary: 'b', paused: false }),
    ])
    expect((await provider.loadReviewState('s1'))?.turnsSinceMemory).toBe(1)
    expect((await provider.loadReviewState('s2'))?.turnsSinceMemory).toBe(2)
    expect((await provider.loadCuratorState())?.lastSummary).toBe('b')
    await rm(root, { recursive: true, force: true })
  })

  it('returns the existing record with applied:false on a status mismatch (E-10, 0.3.17 — json provider)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-e10-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    expect((await provider.tryResolvePending('p1', 'approved')).applied).toBe(true)
    const second = await provider.tryResolvePending('p1', 'rejected')
    expect(second.applied).toBe(false)
    expect(second.record).not.toBeNull()
    await rm(root, { recursive: true, force: true })
  })

  it('resolves a pending record exactly once under concurrent resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-resolve-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.savePending({ id: 'p1', kind: 'skill', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    const [a, b] = await Promise.all([
      provider.tryResolvePending('p1', 'approved'),
      provider.tryResolvePending('p1', 'approved'),
    ])
    expect([a, b].filter(result => result.applied)).toHaveLength(1)
    expect(await provider.listPending('approved')).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })
})
