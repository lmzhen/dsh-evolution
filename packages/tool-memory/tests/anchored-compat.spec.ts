import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as MemoryFiles from '@deepseek-ai/dsh-memory-files'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import * as ToolMemory from '../src/index.ts'
import * as ToolSkillManage from '@deepseek-ai/dsh-tool-skill-manage'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const anchorEntry = fileURLToPath(new URL('../../test-support/anchored-standard/tool-bootstrap.mjs', import.meta.url))
const Anchored = await import(pathToFileURL(anchorEntry).href) as { apply(ctx: Context, config?: unknown): Promise<void> | void }

function agent(events: Array<Record<string, unknown>> = []) {
  return { session: { id: `session-${events.length}-${Math.random()}`, events } }
}

function stringTool(name: string) {
  return defineTool({
    name,
    description: `${name} dummy tool`,
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute: async () => name,
  })
}

async function mount(root: string) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  // Anchored row must apply before evolution tools, matching its preset order.
  await ctx.plugin(Anchored, {
    bootstrapTools: ['bash', 'str_replace_editor'],
    promoteOn: 'either',
    suppressedContextSources: ['agent-instructions', 'skill-catalog'],
  })
  ctx.tools.register(stringTool('bash'))
  ctx.tools.register(stringTool('str_replace_editor'))
  await ctx.plugin(MemoryRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(MemoryFiles, { root })
  await ctx.plugin(SkillUsageRegistry, { root: join(root, 'skills') })
  await ctx.plugin(ToolMemory, {})
  await ctx.plugin(ToolSkillManage)
  return ctx
}

describe('anchored-standard compatibility', () => {
  it('hides evolution tools during the bootstrap phase', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-anchored-boot-'))
    const ctx = await mount(root)
    const assembly = await ctx.systemPrompt.assemble({ agent: agent() as unknown as Agent })
    const names = assembly.tools.map(tool => tool.name)
    expect(names).toContain('bash')
    expect(names).toContain('str_replace_editor')
    expect(names).not.toContain('memory')
    expect(names).not.toContain('skill_manage')
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps evolution tools hidden after promotion until explicitly unlocked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-anchored-promoted-'))
    const ctx = await mount(root)
    const assembly = await ctx.systemPrompt.assemble({
      agent: agent([{ type: 'assistant/message', seq: 1, time: 1, data: {} }]) as unknown as Agent,
    })
    const names = assembly.tools.map(tool => tool.name)
    expect(names).not.toContain('memory')
    expect(names).not.toContain('skill_manage')
    rmSync(root, { recursive: true, force: true })
  })

  it('exposes memory after dev_tool_search unlocks it, matching the anchored contract', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-anchored-unlock-'))
    const ctx = await mount(root)
    const assembly = await ctx.systemPrompt.assemble({
      agent: agent([{
        type: 'tool/call',
        seq: 1,
        time: 1,
        data: { name: 'dev_tool_search', arguments: JSON.stringify({ toolNames: ['memory'] }) },
      }]) as unknown as Agent,
    })
    const names = assembly.tools.map(tool => tool.name)
    expect(names).toContain('memory')
    expect(names).not.toContain('skill_manage')
    rmSync(root, { recursive: true, force: true })
  })
})
