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
    // v20 (A-3): hasProvider() was removed (same zero-consumer rationale as
    // hasProviders() in P3-D1) — presence probes go through provider(),
    // which fails loud on a missing name.
    expect(ctx2.evolutionIo.provider('a').name).toBe('a')
    expect(ctx2.evolutionIo.provider('b').name).toBe('b')
    expect(() => ctx2.evolutionIo.provider('c')).toThrow(/not registered/)
  })

  it('P2-3 (v15): identical-object re-registration is idempotent; a DIFFERENT object under the name still fails loud', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    const calls: string[] = []
    // The io-node singleton shape: ONE object, registered on every mount.
    const provider = fake('node', calls)
    const dispose1 = ctx.evolutionIo.registerProvider(provider, { default: true })
    // Same OBJECT again (a second apply / re-mounted row) — no throw, no
    // duplicate registration, and the returned dispose is identity-guarded.
    const dispose2 = ctx.evolutionIo.registerProvider(provider, { default: true })
    expect(ctx.evolutionIo.provider().name).toBe('node')
    expect(() => ctx.evolutionIo.registerProvider(fake('node'))).toThrow(/already registered/)
    // The seam hands back the registered object itself (no wrapper), so every
    // consumer method reaches the backend unchanged.
    await provider.readText('/x')
    await provider.writeText('/x', 'body')
    await provider.exists('/x')
    expect(calls).toEqual(['read:/x', 'write:/x', 'exists:/x'])
    // Disposing is idempotent: the idempotent re-registration returns the
    // SAME dispose instance, so whichever handle fires first removes the
    // registration and every later call is a no-op.
    dispose2()
    expect(() => ctx.evolutionIo.provider()).toThrow(/no evolution IO provider/)
    dispose1()
    expect(() => ctx.evolutionIo.provider()).toThrow(/no evolution IO provider/)
  })
})
