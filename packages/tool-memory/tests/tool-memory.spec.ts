import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as MemoryFiles from '@deepseek-ai/dsh-memory-files'
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'
import * as ToolMemory from '../src/index.ts'
import { MEMORY_GUIDANCE, MEMORY_TOOL_DESCRIPTION } from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { clearReviewChannel, markReviewChannel } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

/** The `memory` tool's declared output schema, as the tests read it back. */
interface MemoryToolResult {
  ok: boolean
  message: string
  entries: string[]
  chars: number
  limit: number
  pending_id?: string
}

describe('tool-memory', () => {
  it('registers the memory tool', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
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
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
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
    const execArg = { agent: { session: { header: { version: 0, id: 's1', createdAt: 0 }, snapshotEvents: () => [] } } } as unknown as Parameters<typeof tool.execute>[1]
    await tool.execute(
      { target: 'memory', action: 'add', facts: 'remember x' },
      execArg,
    )
    expect(captured?.sessionPolicy).toBe('never')
  })

  it('S1-B1: the review-channel session mark resolves memory writes to background_review', async () => {
    // P1-2 fix: this tool used to skip the v37 S2.2 mark (unlike
    // skill_manage), so an inject-mode review's memory write resolved as
    // 'foreground' — mislabeled in the approval queue and, under
    // `stageForeground: false`, executing without staging at all. The
    // captured request origin must now match skill_manage's on both sides.
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    const captured: { origin?: string }[] = []
    ctx.provide('evolutionApproval', {
      request: async (input: { origin?: string }) => {
        captured.push(input)
        return { action: 'staged', message: 'staged' }
      },
      registerRunner: () => () => {},
    })
    await ctx.plugin(ToolMemory, {})
    const tool = ctx.tools.get('memory')!
    const MARKED = 's1-b1-marked-review-session'
    const PLAIN = 's1-b1-plain-session'
    try {
      // Marked session (inject-mode review in flight): background_review.
      // (Session id rides on the session itself — the platform exec shape —
      // with only the origin on the header, as the platform builds it.)
      markReviewChannel(MARKED)
      const markedShape = { agent: { session: { id: MARKED, header: { origin: undefined }, snapshotEvents: () => [] } } }
      const execMarked = markedShape as unknown as Parameters<typeof tool.execute>[1]
      await tool.execute({ target: 'memory', action: 'add', facts: 'review-channel fact' }, execMarked)
      expect(captured.at(-1)?.origin).toBe('background_review')
      // Unmarked session: unchanged foreground.
      const plainShape = { agent: { session: { id: PLAIN, header: {}, snapshotEvents: () => [] } } }
      const execPlain = plainShape as unknown as Parameters<typeof tool.execute>[1]
      await tool.execute({ target: 'memory', action: 'add', facts: 'foreground fact' }, execPlain)
      expect(captured.at(-1)?.origin).toBe('foreground')
      // Delegated subagent session: still background_review (pre-existing rule).
      const execSubagent = { agent: { session: { id: 's1-b1-sub', header: { origin: 'subagent' }, snapshotEvents: () => [] } } } as unknown as Parameters<typeof tool.execute>[1]
      await tool.execute({ target: 'memory', action: 'add', facts: 'subagent fact' }, execSubagent)
      expect(captured.at(-1)?.origin).toBe('background_review')
    } finally {
      clearReviewChannel(MARKED)
    }
  })

  it('V4-15: a single add to the default memory target does not stage "memory memory" (F-329)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    const summaries: string[] = []
    ctx.provide('evolutionApproval', {
      request: async (input: { summary?: string }) => {
        summaries.push(input.summary ?? '')
        return { action: 'staged', message: 'staged' }
      },
      registerRunner: () => () => {},
    })
    await ctx.plugin(ToolMemory, {})
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: { session: { header: { version: 0, id: 's4', createdAt: 0 }, snapshotEvents: () => [] } } } as unknown as Parameters<typeof tool.execute>[1]
    // A lone add to the default 'memory' target was previously staged as
    // "memory memory add" (normalizeSummary only rewrote batches >1). F-329
    // applies the single-word rule for a single op at the summary source.
    const single = await tool.execute({ target: 'memory', action: 'add', facts: 'remember x' }, execArg) as MemoryToolResult
    expect(single.ok).toBe(true)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toBe('memory add')
    expect(summaries[0]).not.toMatch(/memory memory/)
    // A single-element operations batch used to stage "memory memory 1 ops".
    const batched = await tool.execute({ target: 'memory', operations: [{ action: 'add', facts: 'remember y' }] }, execArg) as MemoryToolResult
    expect(batched.ok).toBe(true)
    expect(summaries).toHaveLength(2)
    expect(summaries[1]).toBe('memory 1 ops')
    expect(summaries[1]).not.toMatch(/memory memory/)
  })

  // P2-23 (v37): the tool's declared output contract — validated by the platform with
  // Number.isInteger for `integer` fields — is the invariant the fix has to satisfy.
  it('P2-23: a fractional configured char limit still satisfies the declared integer output', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    // 21000.5 is the reported deployment value: the schema passes it (.min(1)).
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-'), memoryCharLimit: 21_000.5 })
    await ctx.plugin(ToolMemory, {})
    const declared = (ctx.tools.get('memory') as unknown as {
      output: { schema: { properties: Record<string, { type?: string } | undefined> } }
    }).output.schema.properties
    expect(declared.chars?.type).toBe('integer')
    expect(declared.limit?.type).toBe('integer')
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: undefined } as unknown as Parameters<typeof tool.execute>[1]
    const result = await tool.execute({ target: 'memory', action: 'add', facts: 'user prefers terse' }, execArg) as MemoryToolResult
    expect(result.ok).toBe(true)
    // Platform validation for the declared 'integer': both fields must be whole numbers.
    expect(Number.isInteger(result.limit)).toBe(true)
    expect(Number.isInteger(result.chars)).toBe(true)
    expect(result.limit).toBe(21_000)
    expect(await ctx.memory.read('memory')).toContain('user prefers terse')
  })

  it('V24-20a: a null operations ELEMENT is refused structurally through the schema-bypassed replay runner', async () => {
    // The tool schema rejects `operations: [null]` before execute, so the
    // reachable route for this garbage is the approval replay runner, which
    // calls executeCore DIRECTLY with the stored staged args (R-2 precedent).
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    ctx.provide('evolutionState', {
      listPending: async () => [],
      savePending: async () => {},
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    await ctx.plugin(ToolMemory, {})
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(true)
    const nullElement = await ctx.evolutionApproval.run('memory', { target: 'memory', operations: [null] }, { interface: 'background_review' })
    expect(nullElement.ok).toBe(false)
    expect(nullElement.message).toContain('must be an object')
    expect(nullElement.message).not.toContain('TypeError')
  })

  it('bypass writes refresh the model-visible snapshot through the applied event (P2 fix)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
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
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    await ctx.plugin(ToolMemory, {})
    const spy = vi.spyOn(ctx.memory, 'renderContext')
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: { session: { header: { version: 0, id: 's2', createdAt: 0 }, snapshotEvents: () => [] } } } as unknown as Parameters<typeof tool.execute>[1]
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
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
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
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    // A write through the tool cures the empty snapshot via the applied event.
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: { session: { header: { version: 0, id: 's3', createdAt: 0 }, snapshotEvents: () => [] } } } as unknown as Parameters<typeof tool.execute>[1]
    const result = await tool.execute({ target: 'memory', action: 'add', facts: 'E67-late-provider-fact' }, execArg) as MemoryToolResult
    expect(result.ok).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 80))
    const systemPrompt = ctx.get('systemPrompt') as { assemble(): Promise<{ contexts?: Array<{ name?: string; text?: string }> }> } | undefined
    const assembled = await systemPrompt?.assemble()
    const snapshot = (assembled?.contexts ?? []).find(c => c.name === 'evolution:memory-snapshot')?.text ?? ''
    expect(snapshot).toContain('E67-late-provider-fact')
  })

  it('V6-06: NaN entryPreviewChars falls back to the default at assembly (0.3.35)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    // NaN passes the schema; without the assembly clamp `slice(0, NaN)`
    // echoed an EMPTY preview for every entry instead of the default cap.
    await ctx.plugin(ToolMemory, { entryPreviewChars: NaN })
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: { session: { header: { version: 0, id: 's6', createdAt: 0 }, snapshotEvents: () => [] } } } as unknown as Parameters<typeof tool.execute>[1]
    const result = await tool.execute({ target: 'memory', action: 'add', facts: 'x'.repeat(300) }, execArg) as MemoryToolResult
    expect(result.ok).toBe(true)
    const entries = result.entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toHaveLength(200)
  })

  it('V7-07: an empty operations array is rejected BEFORE the approval gate (0.3.43)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    let approvals = 0
    ctx.provide('evolutionApproval', {
      request: async () => { approvals += 1; return { action: 'staged', message: 'staged' } },
      registerRunner: () => () => {},
    })
    await ctx.plugin(ToolMemory, {})
    const tool = ctx.tools.get('memory')!
    const execArg = { agent: { session: { header: { version: 0, id: 's8', createdAt: 0 }, snapshotEvents: () => [] } } } as unknown as Parameters<typeof tool.execute>[1]
    const result = await tool.execute({ target: 'memory', operations: [] as never }, execArg) as MemoryToolResult
    expect(result.ok).toBe(false)
    expect(result.message).toContain('No operations provided')
    expect(approvals).toBe(0)
  })

  it('F-14 (v18): memoryEnabled:false makes the whole row a no-op (no memory tool)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    await ctx.plugin(ToolMemory, { memoryEnabled: false })
    expect(ctx.tools.get('memory')).toBeUndefined()
  })

  it('S1-B3: memoryEnabled:false still registers a refusal runner so staged writes are not orphaned', async () => {
    // P1-2 companion (STATE-05): with the tool disabled, a prior staged write
    // used to hit approve with NO runner — the claim was released back to
    // pending and the record could never be resolved. The refusal runner gives
    // approve a clear, final answer instead.
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    ctx.provide('evolutionState', {
      listPending: async () => [],
      savePending: async () => {},
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })
    // Shipped composition order: the tool row mounts BEFORE the approval row,
    // so the runner registers through the trailing availability inject when
    // approval arrives — exactly what this order exercises.
    await ctx.plugin(MemoryRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-evolution-tmp-') })
    await ctx.plugin(ToolMemory, { memoryEnabled: false })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    await new Promise(r => setTimeout(r, 50))
    expect(ctx.tools.get('memory')).toBeUndefined()
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(true)    // The replay intent path must answer with the explicit refusal, not the
    // old "No replay runner registered" bounce.
    const refusal = await ctx.evolutionApproval.run('memory', { target: 'memory', action: 'add', facts: 'x' }, { interface: 'background_review' })
    expect(refusal.ok).toBe(false)
    expect(refusal.message).toContain('memoryEnabled')
  })
})

