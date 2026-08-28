import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Commands from '../src/index.ts'

describe('evolution-commands', () => {
  it('loads without the commands service mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(Commands)
    expect(ctx.get('commands')).toBeUndefined()
  })

  it('dispatches consolidate and skill restore to the curator service', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const calls: string[] = []
    ctx.provide('evolutionCurator', {
      consolidate: async (target: string, sources: string[]) => {
        calls.push(`consolidate:${target}:${sources.join(',')}`)
        return { ok: true, message: `Consolidated ${sources.join(', ')} into "${target}".` }
      },
      restore: async (name: string) => {
        calls.push(`restore:${name}`)
        return { ok: true, message: `Skill "${name}" restored from .archive.` }
      },
    })
    await ctx.plugin(Commands)
    expect(captured).toBeDefined()
    const result = await captured!.handler({ rawInput: 'consolidate target-a source-b source-c' })
    expect(result.text).toContain('Consolidated source-b, source-c into "target-a".')
    expect(calls).toEqual(['consolidate:target-a:source-b,source-c'])
    const restoreResult = await captured!.handler({ rawInput: 'skill restore source-b' })
    expect(restoreResult.text).toContain('restored from .archive.')
    expect(calls).toEqual(['consolidate:target-a:source-b,source-c', 'restore:source-b'])
    // Commands runtime contract: handlers must return a CommandResult with kind.
    expect(result.kind).toBe('success')
    expect(restoreResult.kind).toBe('success')
    const missing = await captured!.handler({ rawInput: 'approve some-id' })
    expect(missing.kind).toBe('error')
  })

  it('learn returns the standards-guided skill distillation prompt', async () => {    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    await ctx.plugin(Commands)
    const withRequest = await captured!.handler({ rawInput: 'learn distill the auth flow from <url>' })
    expect(withRequest.text).toContain('THE REQUEST:')
    expect(withRequest.text).toContain('distill the auth flow from <url>')
    expect(withRequest.text).toContain('skill-authoring standards')
    expect(withRequest.text).toContain('skill_manage')
    // Empty argument falls back to the "what we just did" guidance.
    const empty = await captured!.handler({ rawInput: 'learn' })
    expect(empty.text).toContain('the workflow we just went through')
  })

  it('curator scope renders the lifecycle lists including quality-warned', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    ctx.provide('evolutionCurator', {
      scopeView: async () => ({ managed: ['hub-skill'], watched: ['stale-skill', 'warn-skill'], qualityWarned: ['warn-skill'], exempted: ['scheduled'], protected: ['pinned-skill'] }),
    })
    await ctx.plugin(Commands)
    const result = await captured!.handler({ rawInput: 'curator scope' })
    expect(result.text).toContain('Managed (may transition): 1')
    expect(result.text).toContain('hub-skill')
    expect(result.text).toContain('Watched (stale / quality-warned): 2')
    expect(result.text).toContain('Quality-warned: 1')
    expect(result.text).toContain('warn-skill')
    expect(result.text).toContain('Exempted (exclude / referenced): 1')
    expect(result.text).toContain('scheduled')
    expect(result.text).toContain('Protected (pinned / bundled / hub): 1')
  })

  it('restore dispatches the full-state snapshot restore to the curator', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const calls: string[] = []
    ctx.provide('evolutionCurator', {
      restoreSnapshot: async () => {
        calls.push('restoreSnapshot')
        return { ok: true, message: 'Restored skill tree from /path' }
      },
    })
    await ctx.plugin(Commands)
    const result = await captured!.handler({ rawInput: 'restore snap' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Restored skill tree from /path')
    expect(calls).toEqual(['restoreSnapshot'])
  })
  it('dispatches curator pause/resume/status to the curator service (G2)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const calls: Array<{ paused: boolean }> = []
    let state: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null = {
      lastRunAt: Date.now() - 3_600_000, runCount: 2, lastSummary: 'auto: stale:0 archived:0', paused: false,
    }
    ctx.provide('evolutionCurator', {
      setPaused: async (paused: boolean) => {
        calls.push({ paused })
        state = { ...state!, paused }
      },
      status: async () => state,
    })
    await ctx.plugin(Commands)
    const pause = await captured!.handler({ rawInput: 'curator pause' })
    expect(pause.kind).toBe('success')
    expect(pause.text).toContain('paused')
    expect(calls).toEqual([{ paused: true }])
    const status = await captured!.handler({ rawInput: 'curator status' })
    expect(status.kind).toBe('success')
    expect(status.text).toContain('paused=true')
    expect(status.text).toContain('runs=2')
    const resume = await captured!.handler({ rawInput: 'curator resume' })
    expect(resume.text).toContain('resumed')
    expect(calls).toEqual([{ paused: true }, { paused: false }])
    // Without persisted state the status command degrades gracefully.
    state = null
    const empty = await captured!.handler({ rawInput: 'curator status' })
    expect(empty.text).toContain('No curator state yet')
  })

})
