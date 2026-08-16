import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionStateStorageRegistry from '../src/index.ts'

const provider = (name: string) => ({
  name,
  loadReviewState: async () => null,
  saveReviewState: async () => {},
  loadCuratorState: async () => null,
  saveCuratorState: async () => {},
  listPending: async () => [],
  savePending: async () => {},
  deletePending: async () => {},
  tryResolvePending: async () => ({ record: null, applied: false }),
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
})
