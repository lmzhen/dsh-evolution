import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'

async function mount(root: string) {
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root })
  return ctx
}

describe('evolution-state-json transactCuratorState null semantics (G2.1, F-202)', () => {
  it('creates the file when the missing key is seeded by a task that returns a record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-tc-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    expect(await provider.loadCuratorState()).toBeNull()
    await provider.transactCuratorState(() => ({ lastRunAt: 1, runCount: 0, lastSummary: 'a', paused: false }))
    expect(await provider.loadCuratorState()).toEqual({ lastRunAt: 1, runCount: 0, lastSummary: 'a', paused: false })
    expect(await io.exists(join(root, 'curator-state.json'))).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('returns null (keep) on a missing seed and writes no file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-tc2-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await provider.transactCuratorState(() => null)
    expect(await provider.loadCuratorState()).toBeNull()
    expect(await io.exists(join(root, 'curator-state.json'))).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('a null return keeps an existing record unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-tc3-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(() => null)
    expect((await provider.loadCuratorState())?.lastSummary).toBe('orig')
    const raw = JSON.parse(await io.readText(join(root, 'curator-state.json'))) as { primary: { lastSummary: string } }
    expect(raw.primary.lastSummary).toBe('orig')
    await rm(root, { recursive: true, force: true })
  })

  it('a returning task overwrites the existing primary record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-tc4-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(current => ({ ...current!, lastSummary: 'new', runCount: 6 }))
    expect((await provider.loadCuratorState())?.lastSummary).toBe('new')
    expect((await provider.loadCuratorState())?.runCount).toBe(6)
    await rm(root, { recursive: true, force: true })
  })
})
