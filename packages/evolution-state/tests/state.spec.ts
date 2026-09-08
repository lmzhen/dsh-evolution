import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as JsonState from '@deepseek-ai/dsh-evolution-state-json'
import EvolutionState from '../src/index.ts'

describe('evolution-state', () => {
  it('delegates to the mounted storage provider', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-state-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.evolutionState.saveReviewState('s1', { turnsSinceMemory: 3, turnsSinceSkill: 5, lastTurn: 9 })
    expect(await ctx.evolutionState.loadReviewState('s1')).toEqual({ turnsSinceMemory: 3, turnsSinceSkill: 5, lastTurn: 9 })
    await ctx.evolutionState.saveCuratorState({ lastRunAt: 1, runCount: 2, lastSummary: 'ok', paused: false })
    expect((await ctx.evolutionState.loadCuratorState())?.runCount).toBe(2)
    await ctx.evolutionState.savePending({ id: 'p1', kind: 'memory', summary: 'add', args: {}, createdAt: 'now', status: 'pending' })
    expect(await ctx.evolutionState.listPending()).toHaveLength(1)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('S-07: a pinned provider typo fails at MOUNT when a provider is already registered', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-state-typo-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    // A provider IS registered (json), so the pinned-but-wrong name must fail
    // at start with the registry's precise message — not at the first state
    // access, far away from the config mistake.
    await expect(ctx.plugin(EvolutionState, { provider: 'jso' })).rejects.toThrow(/provider "jso" is not registered/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('S-07: stays lazy when no provider has registered yet (mount order not settled)', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    // Empty registry: the constructor must NOT throw; the pinned name is
    // verified at the first state access instead.
    await ctx.plugin(EvolutionState, { provider: 'typo' })
    expect(() => ctx.evolutionState.loadReviewState('s1')).toThrow(/provider "typo" is not registered/)
  })
})
