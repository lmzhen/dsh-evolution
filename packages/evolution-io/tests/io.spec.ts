import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '../src/index.ts'

describe('EvolutionIoRegistry', () => {
  it('requires a provider and disposes it', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    expect(() => ctx.evolutionIo.provider()).toThrow(/no evolution IO provider/)
    const dispose = ctx.evolutionIo.registerProvider({
      name: 'test',
      readText: async () => null,
      writeText: async () => {},
      remove: async () => {},
      list: async () => [],
      exists: async () => false,
      rename: async () => {},
      copy: async () => {},
    })
    expect(ctx.evolutionIo.provider('test').name).toBe('test')
    dispose()
    expect(() => ctx.evolutionIo.provider('test')).toThrow(/not registered/)
  })
})
