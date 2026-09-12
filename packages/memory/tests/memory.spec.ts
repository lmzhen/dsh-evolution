import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRegistry, { type MemoryProvider } from '../src/index.ts'

const provider: MemoryProvider = {
  name: 'test',
  async read() { return ['a'] },
  async applyBatch() { return { ok: true, message: 'ok', entries: ['a'], chars: 1, limit: 10 } },
  async snapshot() { return { version: 1, sha256: 'x', memory: ['a'], user: [] } },
  async renderContext() { return 'a' },
}

describe('MemoryRegistry', () => {
  it('rejects unknown provider reads and disposes providers', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry)
    expect(() => ctx.memory.read('memory')).toThrow(/no provider/)
    const dispose = ctx.memory.registerProvider(provider)
    expect(await ctx.memory.read('memory')).toEqual(['a'])
    dispose()
    expect(() => ctx.memory.read('memory')).toThrow(/no provider/)
  })

  it('emits evolution/memory-applied after any successful write (P2 fix)', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry)
    ctx.memory.registerProvider(provider)
    const seen: Array<{ target: string; chars: number; entries: number }> = []
    ctx.on('evolution/memory-applied', (event) => { seen.push(event) })
    const result = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: 'x' }])
    expect(result.ok).toBe(true)
    expect(seen).toEqual([{ target: 'memory', chars: 1, entries: 1 }])
  })

  it('V27 G6.3: config.provider pins the provider for every delegation, not row order', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry, { provider: 'second' })
    const first: MemoryProvider = { ...provider, name: 'first', async read() { return ['first'] } }
    const second: MemoryProvider = { ...provider, name: 'second', async read() { return ['second'] } }
    // Mount order does not decide the store: the pin resolves when its provider
    // registers, wherever that happens in the row list.
    ctx.memory.registerProvider(first)
    ctx.memory.registerProvider(second)
    expect(await ctx.memory.read('memory')).toEqual(['second'])
    // Without a pin the FIRST registered provider serves the reads — the
    // documented row-order default, never a silent switch of stores.
    const plain = new Context()
    await plain.plugin(MemoryRegistry)
    plain.memory.registerProvider(first)
    plain.memory.registerProvider(second)
    expect(await plain.memory.read('memory')).toEqual(['first'])
  })

  it('V27 G6.3: an unsatisfied pin warns at registration and fails the first access', async () => {
    const { vi } = await import('vitest')
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry, { provider: 'typo-name' })
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    ctx.memory.registerProvider(provider)
    // Earliest visible signal: the pin cannot be satisfied by what mounted.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('config.provider="typo-name" is not registered'))
    warnSpy.mockRestore()
    // Hard failure: the read names the pin instead of silently serving the
    // provider that did mount.
    expect(() => ctx.memory.read('memory')).toThrow(/memory provider "typo-name" is not registered/)
    // A pin whose provider mounts LATER is satisfied — the warning is a signal,
    // never a refusal of a mount order that may still be resolving.
    const late = new Context()
    await late.plugin(MemoryRegistry, { provider: 'second' })
    late.memory.registerProvider({ ...provider, name: 'first' })
    const lateSpy = vi.spyOn(late.logger, 'warn')
    late.memory.registerProvider({ ...provider, name: 'second', async read() { return ['second'] } })
    expect(lateSpy).not.toHaveBeenCalled()
    lateSpy.mockRestore()
    expect(await late.memory.read('memory')).toEqual(['second'])
  })

  it('F-333: a named provider miss throws instead of silently falling back to the first', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry)
    const first: MemoryProvider = { ...provider, name: 'first' }
    const second: MemoryProvider = { ...provider, name: 'second' }
    ctx.memory.registerProvider(first)
    ctx.memory.registerProvider(second)
    // Named miss surfaces — never writes to the wrong store.
    expect(() => ctx.memory.provider('missing')).toThrow(/memory provider "missing" is not registered/)
    // A named hit returns exactly that provider.
    expect(ctx.memory.provider('second')).toBe(second)
    // No name keeps the backward-compatible first-registered behavior.
    expect(ctx.memory.provider()).toBe(first)
  })

  it('v35 R1: a stale dispose handle cannot remove a newer registration of the same object', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry)
    const stale = ctx.memory.registerProvider(provider)
    stale()
    // Re-registering the SAME singleton is legitimate once the name is free —
    // object identity alone would let the first handle delete this registration.
    ctx.memory.registerProvider(provider)
    stale()
    expect(await ctx.memory.read('memory')).toEqual(['a'])
    // The current handle still disposes, and double-dispose stays a no-op.
    const current = ctx.memory.registerProvider({ ...provider, name: 'other' })
    current()
    current()
    expect(() => ctx.memory.provider('other')).toThrow(/not registered/)
  })
})
