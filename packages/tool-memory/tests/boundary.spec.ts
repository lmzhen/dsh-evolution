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

/** The `memory` tool's declared output schema, as the tests read it back. */
interface MemoryToolResult {
  ok: boolean
  message: string
  entries: string[]
  chars: number
  limit: number
  pending_id?: string
}

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
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('F-06: an exec whose agent lacks a session no longer TypeErrors on origin resolution', async () => {
    const { ctx, root } = await setup()
    // `agent` present but WITHOUT `session`: the old one-level optional chain
    // (`exec.agent?.session.header.origin`) threw TypeError here; the full
    // chain degrades to the default origin and the write proceeds.
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: {} } as unknown as Parameters<typeof tool.execute>[1]
    const result = await tool.execute({ target: 'memory', action: 'add', facts: 'sessionless write' }, execArg) as MemoryToolResult
    expect(result.ok).toBe(true)
    expect(await ctx.memory.read('memory')).toContain('sessionless write')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('F-07: a non-array operations payload returns a shape error instead of degrading to a single operation', async () => {
    const { ctx, root } = await setup()
    // A non-array `operations` used to fall into the single-op branch and
    // WRITE the payload's stray fields as a normal add. The enforcing layer is
    // the tool's parameters schema (rc.2 defineTool wraps execute with arg
    // validation), which refuses the payload BEFORE the body runs — the
    // execute-level shape check in src stays as defense-in-depth for
    // schema-less callers. Pin the observable pipeline behavior: a proper
    // array-shape error, no silent single-op write.
    const result = await ctx.tools.execute({
      callId: CallId('shape'),
      name: 'memory',
      arguments: { target: 'memory', action: 'add', facts: 'ghost write', operations: { action: 'add' } },
      agent: fakeAgent(),
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
    expect(text).toContain('\"operations\" must be an array')
    expect(await ctx.memory.read('memory')).not.toContain('ghost write')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
