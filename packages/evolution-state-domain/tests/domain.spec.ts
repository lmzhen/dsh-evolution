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

describe('evolution-state-domain', () => {
  it('persists state through the storage-domain KV domain', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-state-domain-'))
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('test-json', new JsonStorageBackend(home))
    ctx.provide(storageBackendServiceKey('test-json'), new JsonStorageBackend(home))
    await ctx.plugin(DomainFacility, { backend: 'test-json' })
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(DomainState)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    await rm(home, { recursive: true, force: true })
  })
  it('returns the existing record with applied:false when already resolved to another status (E-10, 0.3.17)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-state-domain-e10-'))
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('test-json', new JsonStorageBackend(home))
    ctx.provide(storageBackendServiceKey('test-json'), new JsonStorageBackend(home))
    await ctx.plugin(DomainFacility, { backend: 'test-json' })
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(DomainState)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    expect((await provider.tryResolvePending('p1', 'approved')).applied).toBe(true)
    // The record EXISTS (audit surface) but nothing was applied — this is the
    // contract the json provider already kept; domain now agrees (E-10).
    const second = await provider.tryResolvePending('p1', 'rejected')
    expect(second.applied).toBe(false)
    expect(second.record).not.toBeNull()
    await rm(home, { recursive: true, force: true })
  })
  it('claim moves the record to executing and never double-claims (S3.3, E-24 — domain parity)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-state-domain-s3-'))
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('test-json', new JsonStorageBackend(home))
    ctx.provide(storageBackendServiceKey('test-json'), new JsonStorageBackend(home))
    await ctx.plugin(DomainFacility, { backend: 'test-json' })
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(DomainState)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    const claimed = await provider.claimPending('p1', 'c1')
    expect(claimed?.status).toBe('executing')
    expect(await provider.claimPending('p1', 'c2')).toBeNull()
    const resolved = await provider.tryResolvePending('p1', 'rejected')
    expect(resolved.applied).toBe(true)
    await rm(home, { recursive: true, force: true })
  })
  it('dispose waits for an in-flight open and closes the domain (E-17, 0.3.17)', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    let closed = false
    let attempts = 0
    ctx.provide('storageDomain', {
      open: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('busy')
        return {
          table: () => ({ get: async () => null, put: async () => {}, entries: () => [], update: async () => null }),
          close: async () => { closed = true },
        } as never
      },
    })
    await ctx.plugin(DomainState)
    const provider = ctx.evolutionStateStorage.provider('domain')
    // Fire a load (which starts the opening with its retry backoff), then
    // dispose the fiber while the second attempt is still in flight.
    void provider.loadReviewState('s1').catch(() => {})
    await ctx.fiber.dispose()
    expect(closed).toBe(true)
    expect(attempts).toBe(2)
  })
  it('retries a transiently failing open and recovers (P1-4)', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    let attempts = 0
    ctx.provide('storageDomain', {
      open: async () => {
        attempts += 1
        if (attempts <= 2) throw new Error(`simulated busy #${attempts}`)
        return {
          table: () => ({ get: async () => null, put: async () => {}, entries: () => [], update: async () => null }),
          close: async () => {},
        } as never
      },
    })
    await ctx.plugin(DomainState)
    const provider = ctx.evolutionStateStorage.provider('domain')
    // Two transient failures then success, inside one ensure() budget.
    expect(await provider.loadCuratorState()).toBeNull()
    expect(attempts).toBe(3)
  })

  it('a permanently failing open clears the poisoned promise so later calls retry (P1-4)', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    let attempts = 0
    ctx.provide('storageDomain', {
      open: async () => {
        attempts += 1
        throw new Error(`simulated down #${attempts}`)
      },
    })
    await ctx.plugin(DomainState)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await expect(provider.loadCuratorState()).rejects.toThrow('simulated down #3')
    // The rejected opening must be cleared: the next call starts a FRESH
    // retry budget instead of re-awaiting the poisoned promise.
    await expect(provider.loadCuratorState()).rejects.toThrow('simulated down #6')
    expect(attempts).toBe(6)
  })

})
