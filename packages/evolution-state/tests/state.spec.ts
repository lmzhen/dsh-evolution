import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionState from '../src/index.ts'

describe('evolution-state', () => {
  it('persists review/curator/pending records through the JSON fallback', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-state-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionState)
    await ctx.evolutionState.saveReviewState('s1', { turnsSinceMemory: 3, turnsSinceSkill: 5, lastTurn: 9 })
    expect(await ctx.evolutionState.loadReviewState('s1')).toEqual({ turnsSinceMemory: 3, turnsSinceSkill: 5, lastTurn: 9 })
    await ctx.evolutionState.saveCuratorState({ lastRunAt: 1, runCount: 2, lastSummary: 'ok', paused: false })
    expect((await ctx.evolutionState.loadCuratorState())?.runCount).toBe(2)
    await ctx.evolutionState.savePending({ id: 'p1', kind: 'memory', summary: 'add', args: {}, createdAt: 'now', status: 'pending' })
    expect(await ctx.evolutionState.listPending()).toHaveLength(1)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
})
