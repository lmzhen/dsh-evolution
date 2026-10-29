// @tier ci-only
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ToolSkillManage from '../src/index.ts'
import { tempHome } from '../../test-support/temp-home.ts'

const seen: Array<Record<string, unknown>> = []
vi.mock('@deepseek-ai/dsh-evolution-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-evolution-core')>()
  return {
    ...actual,
    createSubagentChannel: () => ({
      state: { kind: 'available', provider: 'spawn', preset: { id: 'fake', registered: true } },
      prepare: async () => ({ kind: 'available', provider: 'spawn', preset: { id: 'fake', registered: true } }),
      run: async (spec: Record<string, unknown>) => {
        seen.push(spec)
        return { kind: 'ok', structured: { outcome: 'keep', reason: 'no reusable part', warnings: [] }, childId: 'fake-child', stopReason: 'completed' }
      },
    }),
  }
})

function fakeAgent(): Agent {
  return { id: 'parent', session: { id: 'parent', header: {}, append: () => {} } } as unknown as Agent
}

describe('extract agent proposal mode', () => {
  it('feeds the frozen prompt and candidates, then returns structured proposal', async () => {
    const root = await tempHome('dsh-extract-agent-')
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.plugin(ToolSkillManage)
    const source = '---\nname: agent-source\ndescription: agent source.\n---\n\nIntro.\n\n## Details\n\nReusable.\n'
    const target = '---\nname: agent-target\ndescription: agent target.\n---\n\nTarget.\n'
    const execute = (args: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId('agent-' + Math.random()),
      name: 'skill_manage',
      arguments: args,
      agent: fakeAgent(),
      signal: new AbortController().signal,
    })
    expect((await execute({ action: 'create', name: 'agent-source', content: source })).value?.ok).toBe(true)
    expect((await execute({ action: 'create', name: 'agent-target', content: target })).value?.ok).toBe(true)
    const result = await execute({ action: 'extract', name: 'agent-source', dry_run: true })
    expect(result.value?.ok).toBe(true)
    const proposal = JSON.parse((result.value as { proposal?: string }).proposal ?? '{}') as { outcome?: string; reason?: string }
    expect(proposal.outcome).toBe('keep')
    expect(proposal.reason).toContain('no reusable')
    expect(seen).toHaveLength(1)
    const prompt = String(seen[0]?.promptText ?? '')
    expect(prompt).toContain('EXTRACT INPUT')
    expect(prompt).toContain('agent-target')
  })
})
