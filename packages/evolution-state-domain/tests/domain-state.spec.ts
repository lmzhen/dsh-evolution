import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Storage, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import * as DomainFacility from '@deepseek-ai/dsh-storage-domain'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as DomainState from '../src/index.ts'

async function mount(home: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('test-json', new JsonStorageBackend(home))
  ctx.provide(storageBackendServiceKey('test-json'), new JsonStorageBackend(home))
  await ctx.plugin(DomainFacility, { backend: 'test-json' })
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(DomainState)
  return ctx
}

describe('evolution-state-domain transactCuratorState null semantics (G2.1, F-202)', () => {
  it('seeds a missing key when the task returns a record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    expect(await provider.loadCuratorState()).toBeNull()
    await provider.transactCuratorState(() => ({ lastRunAt: 1, runCount: 0, lastSummary: 'a', paused: false }))
    expect(await provider.loadCuratorState()).toEqual({ lastRunAt: 1, runCount: 0, lastSummary: 'a', paused: false })
    await rm(home, { recursive: true, force: true })
  })

  it('a null return on a missing key keeps the record absent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc2-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.transactCuratorState(() => null)
    expect(await provider.loadCuratorState()).toBeNull()
    await rm(home, { recursive: true, force: true })
  })

  it('a null return keeps an existing record unchanged', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc3-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(() => null)
    expect((await provider.loadCuratorState())?.lastSummary).toBe('orig')
    await rm(home, { recursive: true, force: true })
  })

  it('a returning task overwrites the existing record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc4-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(current => ({ ...current!, lastSummary: 'new', runCount: 6 }))
    expect((await provider.loadCuratorState())?.lastSummary).toBe('new')
    expect((await provider.loadCuratorState())?.runCount).toBe(6)
    await rm(home, { recursive: true, force: true })
  })
})

describe('evolution-state-domain pendingSchema origin/sessionId (G2.3, F-214)', () => {
  it('round-trips origin and sessionId through the medium (not stripped on read)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-o-'))
    // Session A writes the record, then closes.
    let ctx = await mount(home)
    let provider = ctx.evolutionStateStorage.provider('domain')
    await provider.savePending({
      id: 'p-o', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending',
      origin: 'background_review', sessionId: 'sess-1',
    })
    await ctx.fiber.dispose()
    // Session B re-opens the SAME medium — zod must not strip the attribution.
    ctx = await mount(home)
    provider = ctx.evolutionStateStorage.provider('domain')
    const record = (await provider.listPending('pending')).find(r => r.id === 'p-o')
    expect(record?.origin).toBe('background_review')
    expect(record?.sessionId).toBe('sess-1')
    await rm(home, { recursive: true, force: true })
  })

  it('reads undefined origin/sessionId for a record that never set them', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-o2-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.savePending({ id: 'p-x', kind: 'skill', summary: 'y', args: {}, createdAt: 'now', status: 'pending' })
    const record = (await provider.listPending('pending')).find(r => r.id === 'p-x')
    expect(record?.origin).toBeUndefined()
    expect(record?.sessionId).toBeUndefined()
    await rm(home, { recursive: true, force: true })
  })
})

describe('evolution-state-domain releasePendingClaim missing-key (G2.7, F-332)', () => {
  it('is a no-op that does not throw on a missing id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-rel-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await expect(provider.releasePendingClaim('nope', 'claim-x')).resolves.toBeUndefined()
    expect(await provider.listPending('pending')).toHaveLength(0)
    await rm(home, { recursive: true, force: true })
  })
})
