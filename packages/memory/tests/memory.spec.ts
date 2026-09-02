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
})
