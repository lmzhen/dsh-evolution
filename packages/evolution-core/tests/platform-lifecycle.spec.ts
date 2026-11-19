// @tier fast
/**
 * Platform port lifecycle: a service that mounts after EvolutionPlatform (or
 * after EvolutionLlm) must become visible on the next read. The old snapshot
 * behavior made an optional service permanently unavailable.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { EvolutionLlm } from '../src/runtime/llm.ts'
import { EvolutionPlatform } from '../src/runtime/platform.ts'
import { EvolutionProjections } from '../src/runtime/projections.ts'

async function mountedPlatform(): Promise<{ ctx: Context; platform: EvolutionPlatform }> {
  const ctx = new Context()
  await ctx.plugin(EvolutionPlatform)
  return { ctx, platform: ctx.get('evolutionPlatform') as EvolutionPlatform }
}

describe('platform port lifecycle', () => {
  it('sees a tools service that mounts after the platform service', async () => {
    const { ctx, platform } = await mountedPlatform()
    expect(platform.ports.tools).toBeUndefined()
    ctx.provide('tools', {
      register: () => () => {},
      guard: () => () => {},
      restrict: () => () => {},
    })
    expect(platform.ports.tools).toBeDefined()
  })

  it('sees agents and applies the exact-live-root rule', async () => {
    const { ctx, platform } = await mountedPlatform()
    const root = { id: 'root', session: { header: { origin: 'foreground' } } }
    const child = { id: 'child', session: { header: { origin: 'subagent' } } }
    ctx.provide('agents', {
      get: (id: string) => id === root.id ? root : id === child.id ? child : undefined,
    })
    const agents = platform.ports.agents
    expect(agents).toBeDefined()
    expect(agents?.get('root')).toBe(root)
    expect(agents?.isRoot(root)).toBe(true)
    expect(agents?.isRoot(child)).toBe(false)
  })

  it('sees subagents and userQuestions after they mount', async () => {
    const { ctx, platform } = await mountedPlatform()
    expect(platform.ports.subagents).toBeUndefined()
    expect(platform.ports.userQuestions).toBeUndefined()
    ctx.provide('subagents', {
      getProvider: () => ({ name: 'spawn' }),
      startActivation: async () => ({ childId: 'child-1', result: Promise.resolve({}), dispose: async () => {} }),
    })
    ctx.provide('userQuestions', { ask: async () => ({ answers: [] }) })
    expect(platform.ports.subagents?.getProvider('spawn')).toEqual({ name: 'spawn' })
    expect(await platform.ports.userQuestions?.ask({ questions: [] })).toEqual({ answers: [] })
  })

  it('attaches projections when the registry mounts after the service', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPlatform)
    await ctx.plugin(EvolutionProjections)
    const projections = ctx.get('evolutionProjections') as EvolutionProjections
    expect(projections.status()).toBe('degraded')
    await ctx.plugin(SessionProjectionRegistry)
    await vi.waitFor(() => expect(projections.status()).toBe('ready'))
  })

  it('classifies a CONTENT_REFUSED finish error as a decided content refusal', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPlatform)
    await ctx.plugin(EvolutionLlm)
    ctx.provide('llm', {
      stream: () => (async function* () {
        // The rc5 LlmRuntime delivers a refusal in-band as finish(error), never as a thrown error.
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'DeepSeek refused to answer', code: 'CONTENT_REFUSED' } } }
      })(),
    })
    const llm = ctx.get('evolutionLlm') as EvolutionLlm
    await expect(llm.text({
      purpose: 'evolution-curator',
      route: { provider: 'deepseek', model: 'deepseek-chat' },
      messages: [],
    })).rejects.toMatchObject({ kind: 'content-refused' })
  })
})
