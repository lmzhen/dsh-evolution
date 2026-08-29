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
    // Explicit root keeps the usage sidecar local to this fixture instead of
    // sharing a registry-level default across tests (B7).
    await ctx.plugin(SkillUsageRegistry, { root })
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

  it('mounts the Hermes SKILLS_GUIDANCE system-prompt section (alignment)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root: await mkdtemp(join(tmpdir(), 'dsh-skill-usage-guidance-')) })
    await ctx.plugin(ToolSkillManage)
    const assembly = await ctx.systemPrompt.assemble()
    const rendered = (assembly.sections ?? []).map(s => (typeof s === 'string' ? s : s.text)).join('\n')
    expect(rendered).toContain('Skills guidance:')
    expect(rendered).toContain('don\'t wait to be asked')
    await ctx.fiber.dispose()
  })

  it('reports the authoring check on create and refuses under descriptionStrict (P0)', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (args: Record<string, unknown>) => ctx.tools.execute({
      callId: CallId(`authoring-${Math.random()}`),
      name: 'skill_manage',
      arguments: args,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    const over = 'A comprehensive skill that lets the agent search arXiv for academic papers using keywords, authors, and categories. '
    const created = await execute({ action: 'create', name: 'authoring-skill', content: SKILL.replace('boundary-skill', 'authoring-skill').replace('lifecycle boundary test', over) })
    expect(created.isError).toBe(false)
    const message = (created.value as { message?: string } | undefined)?.message ?? ''
    expect(message).toContain('Authoring check:')
    expect(message).toContain('exceeds the authoring bar')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })

  it('refuses an over-bar description when descriptionStrict is enabled (P0)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-strict-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      await ctx.plugin(SkillUsageRegistry, { root })
      await ctx.plugin(ToolSkillManage, { descriptionStrict: true })
      const over = 'A comprehensive skill that lets the agent search arXiv for academic papers using keywords, authors, and categories. '
      const result = await ctx.tools.execute({
        callId: CallId(`strict-${Math.random()}`),
        name: 'skill_manage',
        arguments: { action: 'create', name: 'strict-skill', content: SKILL.replace('boundary-skill', 'strict-skill').replace('lifecycle boundary test', over) },
        agent: fakeAgent(undefined),
        signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect((result.value as { ok?: boolean; message?: string } | undefined)?.ok).toBe(false)
      expect((result.value as { message?: string } | undefined)?.message ?? '').toContain('exceeds the strict bar')
      await ctx.fiber.dispose()
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true })
    }
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
    // Create is authorship, not a patch (rc.44 M3-3.3): the counter stays 0
    // so mutation maturity is not inflated by mere creation.
    const patchesBefore = (await ctx.skillUsage.report()).get('audit-skill')?.patch_count ?? 0
    expect(patchesBefore).toBe(0)
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

  it('review text aggregates quality-warned skills into one guidance line', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: CallId(`quality-warn-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    await execute({ action: 'create', name: 'warned-skill', content: SKILL.replace('boundary-skill', 'warned-skill') })
    await ctx.skillUsage.setQuality('warned-skill', 0.1, true)
    const review = await execute({ action: 'review' })
    expect(review.isError).toBe(false)
    const message = (review.value as { message?: string } | undefined)?.message ?? ''
    expect(message).toContain('Warning skills (1): warned-skill')
    expect(message).toContain('consider consolidating')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })

  it('review text marks protection with [pinned] (N-1)', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: CallId(`pin-mark-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    await execute({ action: 'create', name: 'pinned-review', content: SKILL.replace('boundary-skill', 'pinned-review') })
    await execute({ action: 'pin', name: 'pinned-review' })
    const review = await execute({ action: 'review' })
    expect(review.isError).toBe(false)
    const message = (review.value as { message?: string } | undefined)?.message ?? ''
    expect(message).toContain('- pinned-review')
    expect(message).toContain('[pinned]')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })
})


