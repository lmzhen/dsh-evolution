import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as ToolSkillManage from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fakeAgent(origin: string | undefined): Agent {
  return { session: { header: { origin }, append: () => {} } } as unknown as Agent
}

const SKILL = '---\nname: boundary-skill\ndescription: lifecycle boundary test\n---\nBody.\n'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manage-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry)
    await ctx.plugin(ToolSkillManage)
    return { ctx, root, previousHome }
  } catch (error) {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    throw error
  }
}

describe('tool-skill-manage', () => {
  it('registers the skill_manage tool', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root: await mkdtemp(join(tmpdir(), 'dsh-skill-usage-')) })
    await ctx.plugin(ToolSkillManage)
    expect(ctx.tools.get('skill_manage')).toBeDefined()
  })

  it('marks review-created skills for curator lifecycle management, but not foreground writes', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = async (origin: string | undefined, name: string) => ctx.tools.execute({
      callId: CallId(`create-${origin ?? 'foreground'}-${name}`),
      name: 'skill_manage',
      arguments: { action: 'create', name, content: SKILL.replace('boundary-skill', name) },
      agent: fakeAgent(origin),
      signal: new AbortController().signal,
    })
    const background = await execute('subagent', 'review-created')
    expect(background.isError).toBe(false)
    const foreground = await execute(undefined, 'foreground-created')
    expect(foreground.isError).toBe(false)

    const usage = await ctx.skillUsage.report()
    expect(usage.get('review-created')?.created_by).toBe('agent')
    expect(usage.get('foreground-created')?.created_by).toBeNull()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })

  it('review and skip are read-only: no counters, no mutation events', async () => {
    const { ctx, root, previousHome } = await setup()
    let mutationEvents = 0
    ctx.on('evolution/skill-mutated', () => { mutationEvents += 1 })
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: CallId(`review-skip-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    const created = await execute({ action: 'create', name: 'audit-skill', content: SKILL.replace('boundary-skill', 'audit-skill') })
    expect(created.isError).toBe(false)
    expect(mutationEvents).toBe(1)
    const review = await execute({ action: 'review' })
    expect(review.isError).toBe(false)
    expect((review.value as { message?: string } | undefined)?.message ?? '').toContain('Skills:')
    const patchesBefore = (await ctx.skillUsage.report()).get('audit-skill')?.patch_count ?? 0
    const skip = await execute({ action: 'skip' })
    expect(skip.isError).toBe(false)
    // Read-only actions neither bump counters nor emit mutation events. The
    // usage sidecar may be shared across fixtures, so assert on the delta.
    expect(mutationEvents).toBe(1)
    const usage = await ctx.skillUsage.report()
    expect(usage.get('audit-skill')?.patch_count).toBe(patchesBefore)
    expect(usage.get('audit-skill')?.use_count).toBe(0)
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })
})


