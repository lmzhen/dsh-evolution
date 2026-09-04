import { describe, expect, it, vi } from 'vitest'
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

  it('E-20: a foreground tool write refreshes the snapshot exactly once (single sink)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await makeTmp() })
    await ctx.plugin(ToolMemory, {})
    const spy = vi.spyOn(ctx.memory, 'renderContext')
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: { session: { header: { version: 0, id: 's2', createdAt: 0 }, events: [] } } } as unknown as Parameters<typeof tool.execute>[1]
    await tool.execute({ target: 'memory', action: 'add', facts: 'E20-tool-fact' }, execArg)
    // Allow the event→renderContext→snapshotText chain to settle.
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    const systemPrompt = ctx.get('systemPrompt') as { assemble(): Promise<{ contexts?: Array<{ name?: string; text?: string }> }> } | undefined
    const assembled = await systemPrompt?.assemble()
    const snapshot = (assembled?.contexts ?? []).find(c => c.name === 'evolution:memory-snapshot')?.text ?? ''
    expect(snapshot).toContain('E20-tool-fact')
  })

  it('E-67: without systemPrompt the host still boots and the memory tool registers (soft probe)', async () => {
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('tools', {
      register: (tool: { name?: string }) => {
        if (tool?.name) registered.push(tool.name)
        return () => {}
      },
      get: () => undefined,
    } as never)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await makeTmp() })
    // systemPrompt is absent: guidance/snapshot skipped, boot and tool still work.
    await ctx.plugin(ToolMemory, {})
    expect(ctx.get('systemPrompt')).toBeUndefined()
    expect(registered).toContain('memory')
  })

  it('T-13: entryPreviewChars schema rejects zero/negative values (0.3.18)', () => {
    const validate = (value: unknown): boolean => {
      const result = (ToolMemory.Config as unknown as { ['~standard']: { validate(input: unknown): { value?: unknown; issues?: unknown } } })['~standard'].validate(value)
      return result.issues === undefined
    }
    expect(validate({ entryPreviewChars: 0 })).toBe(false)
    expect(validate({ entryPreviewChars: -3 })).toBe(false)
    expect(validate({})).toBe(true)
    expect(validate({ entryPreviewChars: 1 })).toBe(true)
  })

  it('E-67: without a memory provider at mount the plugin boots, starts empty and self-corrects', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    // Boot order trap: tool-memory mounts BEFORE the memory provider registers.
    await ctx.plugin(ToolMemory, {})
    await ctx.plugin(MemoryFiles, { root: await makeTmp() })
    // A write through the tool cures the empty snapshot via the applied event.
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: { session: { header: { version: 0, id: 's3', createdAt: 0 }, events: [] } } } as unknown as Parameters<typeof tool.execute>[1]
    const result = await tool.execute({ target: 'memory', action: 'add', facts: 'E67-late-provider-fact' }, execArg)
    expect(result.ok).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 80))
    const systemPrompt = ctx.get('systemPrompt') as { assemble(): Promise<{ contexts?: Array<{ name?: string; text?: string }> }> } | undefined
    const assembled = await systemPrompt?.assemble()
    const snapshot = (assembled?.contexts ?? []).find(c => c.name === 'evolution:memory-snapshot')?.text ?? ''
    expect(snapshot).toContain('E67-late-provider-fact')
  })
})

async function makeTmp(): Promise<string> {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evolution-tmp-'))
}
