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
})
