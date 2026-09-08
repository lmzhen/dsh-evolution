import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry, { type EvolutionIo } from '../src/index.ts'

function fake(name: string, calls: string[] = []): EvolutionIo {
  return {
    name,
    readText: async (path) => { calls.push(`read:${path}`); return null },
    writeText: async (path) => { calls.push(`write:${path}`) },
    remove: async (path) => { calls.push(`remove:${path}`) },
    list: async (path) => { calls.push(`list:${path}`); return [] },
    exists: async (path) => { calls.push(`exists:${path}`); return false },
    rename: async (path) => { calls.push(`rename:${path}`) },
    copy: async (path) => { calls.push(`copy:${path}`) },
  }
}

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

  it('P2-7 (v14): a nameless provider() resolves the declared default, not registration order', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    // Registered first, but NOT the default.
    ctx.evolutionIo.registerProvider(fake('first'))
    // Registered second and declared the default.
    ctx.evolutionIo.registerProvider(fake('node'), { default: true })
    expect(ctx.evolutionIo.provider().name).toBe('node')
    expect(ctx.evolutionIo.provider('first').name).toBe('first')
    // Without a declared default the historical registration-order fallback stays.
    const ctx2 = new Context()
    await ctx2.plugin(EvolutionIoRegistry)
    ctx2.evolutionIo.registerProvider(fake('a'))
    ctx2.evolutionIo.registerProvider(fake('b'))
    expect(ctx2.evolutionIo.provider().name).toBe('a')
    expect(ctx2.evolutionIo.hasProvider('a')).toBe(true)
    expect(ctx2.evolutionIo.hasProvider('b')).toBe(true)
    expect(ctx2.evolutionIo.hasProvider('c')).toBe(false)
  })

  it('P3-11 (v14): hasProvider lets a re-mounting provider stay idempotent, duplicates still fail loud', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    const calls: string[] = []
    ctx.evolutionIo.registerProvider(fake('node', calls), { default: true })
    expect(ctx.evolutionIo.hasProvider('node')).toBe(true)
    // A different provider under a taken name is still refused.
    expect(() => ctx.evolutionIo.registerProvider(fake('node'))).toThrow(/already registered/)
    // The seam hands back the registered object itself (no wrapper), so every
    // consumer method reaches the backend unchanged.
    const provider = ctx.evolutionIo.provider()
    await provider.readText('/x')
    await provider.writeText('/x')
    await provider.exists('/x')
    expect(calls).toEqual(['read:/x', 'write:/x', 'exists:/x'])
  })
})
