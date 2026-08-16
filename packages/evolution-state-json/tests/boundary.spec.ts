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

describe('evolution-state-json boundaries', () => {
  it('treats malformed state files as empty instead of failing the service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-boundary-'))
    const ctx = await mount(root)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'review-state.json'), '{not-json')
    await io.writeText(join(root, 'pending-state.json'), '{"p1": ')
    expect(await ctx.evolutionStateStorage.provider('json').loadReviewState('s1')).toBeNull()
    expect(await ctx.evolutionStateStorage.provider('json').listPending()).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('reads the legacy pending.json audit file for upgrade continuity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-legacy-'))
    const ctx = await mount(root)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      p1: { id: 'p1', kind: 'memory', summary: 'legacy', args: {}, createdAt: 'old', status: 'pending' },
    }))
    const pending = await ctx.evolutionStateStorage.provider('json').listPending('pending')
    expect(pending.map(record => record.id)).toEqual(['p1'])
    await rm(root, { recursive: true, force: true })
  })

  it('serializes concurrent state writes without lost updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-concurrent-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await Promise.all([
      provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 }),
      provider.saveReviewState('s2', { turnsSinceMemory: 2, turnsSinceSkill: 0, lastTurn: 2 }),
      provider.saveCuratorState({ lastRunAt: 1, runCount: 1, lastSummary: 'a', paused: false }),
      provider.saveCuratorState({ lastRunAt: 2, runCount: 2, lastSummary: 'b', paused: false }),
    ])
    expect((await provider.loadReviewState('s1'))?.turnsSinceMemory).toBe(1)
    expect((await provider.loadReviewState('s2'))?.turnsSinceMemory).toBe(2)
    expect((await provider.loadCuratorState())?.lastSummary).toBe('b')
    await rm(root, { recursive: true, force: true })
  })

  it('resolves a pending record exactly once under concurrent resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-resolve-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.savePending({ id: 'p1', kind: 'skill', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    const [a, b] = await Promise.all([
      provider.tryResolvePending('p1', 'approved'),
      provider.tryResolvePending('p1', 'approved'),
    ])
    expect([a, b].filter(result => result.applied)).toHaveLength(1)
    expect(await provider.listPending('approved')).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })
})
