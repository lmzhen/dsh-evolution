import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionStateStorageRegistry from '../src/index.ts'

const provider = (name: string) => ({
  name,
  loadReviewState: async () => null,
  saveReviewState: async () => {},
  loadCuratorState: async () => null,
  saveCuratorState: async () => {},
  transactCuratorState: async () => {},
  listPending: async () => [],
  savePending: async () => {},
  tryResolvePending: async () => ({ record: null, applied: false }),
  claimPending: async () => null,
  releasePendingClaim: async () => {},
})

describe('evolution-state-storage', () => {
  it('registers named providers with deterministic first-provider fallback', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    const dispose = ctx.evolutionStateStorage.registerProvider(provider('a'))
    expect(ctx.evolutionStateStorage.provider().name).toBe('a')
    expect(ctx.evolutionStateStorage.provider('a').name).toBe('a')
    expect(() => ctx.evolutionStateStorage.provider('b')).toThrow(/not registered/)
    dispose()
    expect(() => ctx.evolutionStateStorage.provider()).toThrow(/no evolution state storage provider/)
  })

  it('P2-2/P3-4 (v14): the registry forwards pending and curator calls to the selected provider', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    const calls: string[] = []
    const spy = {
      ...provider('a'),
      tryResolvePending: async (id: string, status: string, claimId?: string) => {
        calls.push(`resolve:${id}:${status}:${String(claimId)}`)
        return { record: null, applied: false }
      },
      claimPending: async (id: string) => { calls.push(`claim:${id}`); return null },
      releasePendingClaim: async (id: string, claimId: string) => { calls.push(`release:${id}:${claimId}`) },
      transactCuratorState: async () => { calls.push('transact') },
    }
    ctx.evolutionStateStorage.registerProvider(spy)
    const selected = ctx.evolutionStateStorage.provider()
    await selected.tryResolvePending('x', 'approved', 'claim-1')
    await selected.claimPending('x')
    await selected.releasePendingClaim('x', 'claim-1')
    await selected.transactCuratorState(() => null)
    expect(calls).toEqual(['resolve:x:approved:claim-1', 'claim:x', 'release:x:claim-1', 'transact'])
  })

  it('C-12 (v18): same-object re-registration is idempotent and a stale dispose cannot remove a newer one', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    const one = provider('p1')
    const first = ctx.evolutionStateStorage.registerProvider(one)
    // HMR / re-mounted row: the identical object returns the original dispose.
    expect(ctx.evolutionStateStorage.registerProvider(one)).toBe(first)
    first()
    expect(ctx.evolutionStateStorage.hasProviders()).toBe(false)
    const second = ctx.evolutionStateStorage.registerProvider(one)
    expect(second).not.toBe(first)
    // The stale handle must not remove the live registration (generation guard).
    first()
    expect(ctx.evolutionStateStorage.hasProviders()).toBe(true)
    second()
    expect(ctx.evolutionStateStorage.hasProviders()).toBe(false)
  })
})
