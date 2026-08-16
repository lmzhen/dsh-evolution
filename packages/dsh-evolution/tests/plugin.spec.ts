import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Evolution from '../src/index.ts'

interface RawTool {
  name: string
  parameters: {
    properties: Record<string, { enum?: string[] }>
  }
}

describe('dsh-evolution plugin surface', () => {
  it('registers Hermes-compatible tool names and aliases', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Evolution, { reviewEnabled: false, curatorEnabled: false })

    const memory = ctx.tools.get('memory') as unknown as RawTool
    const skillManage = ctx.tools.get('skill_manage') as unknown as RawTool
    expect(memory).toBeDefined()
    expect(skillManage).toBeDefined()
    expect(memory.parameters.properties.content).toBeDefined()
    expect(skillManage.parameters.properties.action?.enum).toContain('edit')
    expect(skillManage.parameters.properties.action?.enum).toContain('update')
    expect(skillManage.parameters.properties.replace_all).toBeDefined()
  })
})
