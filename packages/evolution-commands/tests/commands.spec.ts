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
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ text: string }> } | undefined
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
  })

  it('learn returns the standards-guided skill distillation prompt', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ text: string }> } | undefined
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
})
