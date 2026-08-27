import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '../src/index.ts'

describe('evolution-io-node', () => {
  it('registers the node provider and writes atomically through the seam', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-io-node-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'nested', 'a.txt'), 'hello')
    expect(await io.readText(join(root, 'nested', 'a.txt'))).toBe('hello')
    expect(await io.exists(join(root, 'nested', 'a.txt'))).toBe(true)
    // The node provider always ships the optional size probe.
    expect(await io.size!(join(root, 'nested', 'a.txt'))).toBe(5)
    expect(await io.size!(join(root, 'nested', 'missing.txt'))).toBe(null)
    await io.copy(join(root, 'nested'), join(root, 'copy'))
    expect(await io.readText(join(root, 'copy', 'a.txt'))).toBe('hello')
    await io.rename(join(root, 'copy', 'a.txt'), join(root, 'renamed.txt'))
    expect(await io.readText(join(root, 'renamed.txt'))).toBe('hello')
    expect(await io.list(root)).toContain('renamed.txt')
    await io.remove(join(root, 'nested'))
    expect(await io.exists(join(root, 'nested', 'a.txt'))).toBe(false)
    await rm(root, { recursive: true, force: true })
  })
})
