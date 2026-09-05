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
})
