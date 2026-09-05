import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as MemoryFiles from '../src/index.ts'

// MemoryCharLimit/userCharLimit 0 is never an "unbounded" meaning (a 0 limit
// would truncate every entry to nothing; MemoryStore keeps its own internal
// defense), so all three clamp to at least 1.
const FIELDS = ['memoryCharLimit', 'userCharLimit', 'maxConsolidationFailures'] as const

async function mount(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(MemoryRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(MemoryFiles, { root: await makeTmp(), ...config })
  return ctx
}

async function makeTmp(): Promise<string> {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evolution-tmp-'))
}

describe('memory-files G3.1 numeric clamping', () => {
  const parse = (input: unknown): unknown => (MemoryFiles.Config as unknown as (i: unknown) => unknown)(input)

  it('schema rejects 0/negative but lets NaN/Infinity through (.min(1))', () => {
    for (const field of FIELDS) {
      expect(() => parse({ [field]: 0 }), `${field} 0`).toThrow()
      expect(() => parse({ [field]: -1 }), `${field} -1`).toThrow()
    }
    const nan = parse({ memoryCharLimit: NaN }) as { memoryCharLimit: number }
    expect(Number.isNaN(nan.memoryCharLimit)).toBe(true)
    const inf = parse({ maxConsolidationFailures: Infinity }) as { maxConsolidationFailures: number }
    expect(inf.maxConsolidationFailures).toBe(Infinity)
  })

  it('assembly applies a NaN numeric config without crashing and keeps the provider working', async () => {
    // NaN passes the schema, so the assembly clamp corrects it; the provider
    // must still register and write.
    const ctx = await mount({ memoryCharLimit: NaN, userCharLimit: NaN, maxConsolidationFailures: NaN })
    const result = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: 'user prefers terse' }])
    expect(result.ok).toBe(true)
    expect(await ctx.memory.read('memory')).toContain('user prefers terse')
  })
})
