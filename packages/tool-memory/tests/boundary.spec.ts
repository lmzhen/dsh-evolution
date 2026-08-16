import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as MemoryFiles from '@deepseek-ai/dsh-memory-files'
import EvolutionPolicy from '@deepseek-ai/dsh-evolution-policy'
import * as ToolMemory from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fakeAgent(): Agent {
  return {
    session: {
      header: { origin: 'subagent' },
      append: () => {},
    },
  } as unknown as Agent
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-memory-boundary-'))
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(MemoryRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(MemoryFiles, { root })
  await ctx.plugin(EvolutionPolicy)
  await ctx.plugin(ToolMemory, {})
  return { ctx, root }
}

describe('tool-memory execution boundaries', () => {
  it('accepts a normal write through the native tool pipeline', async () => {
    const { ctx, root } = await setup()
    const result = await ctx.tools.execute({
      callId: CallId('normal'),
      name: 'memory',
      arguments: { target: 'memory', action: 'add', facts: 'boundary normal' },
      agent: fakeAgent(),
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(await ctx.memory.read('memory')).toContain('boundary normal')
    await rm(root, { recursive: true, force: true })
  })

  it('policy guard denies model-shaped control-plane fields before execution', async () => {
    const { ctx, root } = await setup()
    const result = await ctx.tools.execute({
      callId: CallId('policy'),
      name: 'memory',
      arguments: { target: 'memory', action: 'add', facts: 'boundary policy', policy: 'override' },
      agent: fakeAgent(),
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('evolution-policy'))).toBe(true)
    expect(await ctx.memory.read('memory')).not.toContain('boundary policy')
    await rm(root, { recursive: true, force: true })
  })
})
