import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'

describe('evolution-state-json', () => {
  it('persists review, curator and pending records through the IO seam', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-state-json-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    const provider = ctx.evolutionStateStorage.provider('json')

    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    await provider.saveCuratorState({ lastRunAt: 4, runCount: 5, lastSummary: 'ok', paused: false })
    expect((await provider.loadCuratorState())?.runCount).toBe(5)
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'add', args: {}, createdAt: 'now', status: 'pending' })
    expect(await provider.listPending()).toHaveLength(1)
    expect((await provider.claimPending('p1', 'claim'))?.status).toBe('executing')
    expect(await provider.listPending('executing')).toHaveLength(1)
    await rm(home, { recursive: true, force: true })
  })
})
