import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import * as MemoryFiles from '../src/index.ts'

describe('memory-files', () => {
  it('registers a provider on ctx.memory', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(MemoryFiles, { root: await makeTmp() })
    expect((await ctx.memory.read('memory')).length).toBeGreaterThanOrEqual(0)
    const result = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: 'user prefers terse' }])
    expect(result.ok).toBe(true)
    expect(await ctx.memory.read('memory')).toContain('user prefers terse')
  })
})

async function makeTmp(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return mkdtemp(join(tmpdir(), 'dsh-memory-files-'))
}
