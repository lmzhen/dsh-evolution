import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry, { type EvolutionIo } from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as MemoryFiles from '../src/index.ts'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

describe('memory-files', () => {
  it('registers a provider on ctx.memory', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await makeTmp() })
    expect((await ctx.memory.read('memory')).length).toBeGreaterThanOrEqual(0)
    const result = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: 'user prefers terse' }])
    expect(result.ok).toBe(true)
    expect(await ctx.memory.read('memory')).toContain('user prefers terse')
  })

  it('snapshot reads memory and user in one serialized step — no mixed generation (V4-12)', async () => {
    const root = await makeTmp()
    // Seed a single user fact directly so the snapshot's first USER.md read is
    // the one we gate below.
    await writeFile(join(root, 'USER.md'), 'original fact\n', 'utf8')
    const ctx = new Context()
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    const base = nodeEvolutionIo()
    let userReads = 0
    let signalStarted!: () => void
    const started = new Promise<void>((res) => { signalStarted = res })
    let releaseGate!: () => void
    const gate = new Promise<void>((res) => { releaseGate = res })
    const provider: EvolutionIo = {
      ...base,
      name: 'v4-12-gated',
      readText: async (path: string) => {
        if (path.replaceAll('\\', '/').endsWith('USER.md')) {
          const first = userReads === 0
          userReads += 1
          if (first) { signalStarted(); await gate }
        }
        return base.readText(path)
      },
    }
    ctx.evolutionIo.registerProvider(provider)
    await ctx.plugin(MemoryFiles, { root })
    // Start a snapshot; its USER.md read is gated after the memory read. The
    // fix wraps BOTH reads in one serializedWrite, so a concurrent write is
    // serialized BEHIND the snapshot instead of landing between the two reads.
    const snapping = ctx.memory.snapshot()
    await started
    const applying = ctx.memory.applyBatch('user', [{ action: 'add', facts: 'new fact' }])
    await new Promise(res => setTimeout(res, 20))
    releaseGate()
    const snap = await snapping
    await applying
    // The snapshot saw BOTH stores from the same generation (before the write):
    // it must not contain the fact the concurrent write added mid-snapshot.
    expect(snap.user).toContain('original fact')
    expect(snap.user).not.toContain('new fact')
    // And the write itself did land, after the snapshot completed.
    expect(await ctx.memory.read('user')).toContain('new fact')
    await rm(root, { recursive: true, force: true })
  })
})

async function makeTmp(): Promise<string> {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evolution-tmp-'))
}
