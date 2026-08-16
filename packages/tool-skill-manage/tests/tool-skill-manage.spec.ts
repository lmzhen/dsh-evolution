import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import * as ToolSkillManage from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('tool-skill-manage', () => {
  it('registers the skill_manage tool', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SkillUsageRegistry, { root: await mkdtemp(join(tmpdir(), 'dsh-skill-usage-')) })
    await ctx.plugin(ToolSkillManage, {})
    expect(ctx.tools.get('skill_manage')).toBeDefined()
  })
})
