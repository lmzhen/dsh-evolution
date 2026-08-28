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
