import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as MemoryFiles from '@deepseek-ai/dsh-memory-files'
import * as ToolMemory from '../src/index.ts'
import { MEMORY_GUIDANCE, MEMORY_TOOL_DESCRIPTION } from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

describe('tool-memory', () => {
  it('registers the memory tool', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await makeTmp() })
    await ctx.plugin(ToolMemory, {})
    expect(ctx.tools.get('memory')).toBeDefined()
  })

  it('memory guidance carries durable-fact triggers and the do-not-save list', () => {
    // Guard against future edits dropping the signals that make the model
    // save proactively. These are the load-bearing parts of the guidance.
    expect(MEMORY_GUIDANCE).toMatch(/user preferences/i)
    expect(MEMORY_GUIDANCE).toMatch(/recurring corrections/i)
    expect(MEMORY_GUIDANCE).toMatch(/task progress/i)
    expect(MEMORY_GUIDANCE).toMatch(/session query tool/)
    expect(MEMORY_GUIDANCE).toMatch(/User prefers concise responses/)
    expect(MEMORY_GUIDANCE).toMatch(/Always respond concisely/)
  })

  it('tool description carries when/priority/targets and the skip list', () => {
    expect(MEMORY_TOOL_DESCRIPTION).toMatch(/save proactively/i)
    expect(MEMORY_TOOL_DESCRIPTION).toMatch(/user preferences & corrections/i)
    expect(MEMORY_TOOL_DESCRIPTION).toMatch(/"user" = who the user is/)
    expect(MEMORY_TOOL_DESCRIPTION).toMatch(/session query tool/)
    expect(MEMORY_TOOL_DESCRIPTION).toMatch(/belong in a skill/)
  })

  it('passes the session approval policy to the staged-approval request', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await makeTmp() })
    let captured: { sessionPolicy?: string } | undefined
    ctx.provide('approval', {
      overrideOf: () => 'never',
      config: { policy: 'ask' },
    })
    ctx.provide('evolutionApproval', {
      request: async (input: { sessionPolicy?: string }) => {
        captured = input
        return { action: 'allow', message: 'ok' }
      },
      registerRunner: () => () => {},
    })
    await ctx.plugin(ToolMemory, {})
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: { session: { header: { version: 0, id: 's1', createdAt: 0 }, events: [] } } } as unknown as Parameters<typeof tool.execute>[1]
    await tool.execute(
      { target: 'memory', action: 'add', facts: 'remember x' },
      execArg,
    )
    expect(captured?.sessionPolicy).toBe('never')
  })

  it('bypass writes refresh the model-visible snapshot through the applied event (P2 fix)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await makeTmp() })
    await ctx.plugin(ToolMemory, {})
    // Bypass write — the `/graph memory:` / background-review direct path.
    await ctx.memory.applyBatch('memory', [{ action: 'add', facts: 'P2-bypass-fact' }])
    // Allow the event→renderContext→snapshotText chain to settle.
    await new Promise(resolve => setTimeout(resolve, 80))
    const systemPrompt = ctx.get('systemPrompt') as { assemble(): Promise<{ contexts?: Array<{ name?: string; text?: string }> }> } | undefined
    const assembled = await systemPrompt?.assemble()
    const snapshot = (assembled?.contexts ?? []).find(c => c.name === 'evolution:memory-snapshot')?.text ?? ''
    expect(snapshot).toContain('P2-bypass-fact')
  })
})

async function makeTmp(): Promise<string> {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evolution-tmp-'))
}
