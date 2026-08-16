import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import * as MemoryFiles from '@deepseek-ai/dsh-memory-files'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '@deepseek-ai/dsh-evolution-state-json'
import EvolutionState from '@deepseek-ai/dsh-evolution-state'
import EvolutionPolicy from '@deepseek-ai/dsh-evolution-policy'
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'
import * as EvolutionThreat from '@deepseek-ai/dsh-evolution-threat'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import * as ToolSkillManage from '@deepseek-ai/dsh-tool-skill-manage'
import * as EvolutionSkillCatalog from '@deepseek-ai/dsh-evolution-skill-catalog'

describe('layered installation matrix', () => {
  it('host-only: services exist, model tools do not', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-host-only-'))
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(JsonState, { root: join(root, 'state') })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(MemoryFiles, { root: join(root, 'memories') })
    await ctx.plugin(SkillUsageRegistry, { root: join(root, 'skills') })
    await ctx.plugin(EvolutionApproval, { enabled: false })
    await ctx.plugin(EvolutionPolicy)
    await ctx.plugin(EvolutionThreat)

    expect(ctx.tools.get('memory')).toBeUndefined()
    expect(ctx.tools.get('skill_manage')).toBeUndefined()
    expect(ctx.memory).toBeDefined()
    expect(ctx.skillUsage).toBeDefined()
    expect(ctx.evolutionState).toBeDefined()
    expect(ctx.evolutionPolicy.get().version).toBe(1)

    const memory = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: 'host only' }])
    expect(memory.ok).toBe(true)
    await ctx.skillUsage.record('host-only-skill', 'use')
    await ctx.evolutionState.saveReviewState('host-session', { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    expect(await ctx.evolutionState.loadReviewState('host-session')).toMatchObject({ turnsSinceMemory: 1 })

    await rm(root, { recursive: true, force: true })
  })

  it('host + agent: adding the agent preset exposes model tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-host-agent-'))
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(JsonState, { root: join(root, 'state') })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(MemoryFiles, { root: join(root, 'memories') })
    await ctx.plugin(SkillUsageRegistry, { root: join(root, 'skills') })
    await ctx.plugin(EvolutionApproval, { enabled: false })
    await ctx.plugin(EvolutionPolicy)
    await ctx.plugin(EvolutionThreat)
    expect(ctx.tools.get('memory')).toBeUndefined()

    // Agent plane: standard skill registry plus the three model tool rows.
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ToolMemory, {})
    await ctx.plugin(ToolSkillManage)
    await ctx.plugin(EvolutionSkillCatalog, { root: join(root, 'skills') })

    expect(ctx.tools.get('memory')).toBeDefined()
    expect(ctx.tools.get('skill_manage')).toBeDefined()

    await rm(root, { recursive: true, force: true })
  })
})
