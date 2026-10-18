// @tier pre-tag
/**
 * S4 (W10 §7, B-level substitute for a live HMR click): HMR means "the same family rows are
 * DISPOSED and RE-APPLIED against the same host". The live isolated profile has no watcher, so the
 * spike records the family-side contract instead: a host plugin mounted twice (with a dispose in
 * between) registers exactly its route set each time, releases every route on dispose, and never
 * hits the platform's duplicate-path refusal. Channel state stays available across the cycle.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSubagentChannel } from '@deepseek-ai/dsh-evolution-core'
import * as SkillHistory from '../../evolution-skill-history/src/index.ts'
import { HOST_ROUTES } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { provideHostConnection } from '../../test-support/host-route-harness.ts'

const expectedRoutes = (): string[] => Object.values(HOST_ROUTES.skillHistory).sort()

async function settle(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 20)) }

describe('S4: dispose → re-apply leaves no route residue and no duplicate registration', () => {
  it('registers/releases the same route set across two mount cycles', async () => {
    const ctx = new Context()
    const host = provideHostConnection(ctx)
    const first = await ctx.plugin(SkillHistory)
    await settle()
    expect(host.routes.map(route => route.path).sort()).toEqual(expectedRoutes())
    expect(host.paths).toHaveLength(expectedRoutes().length)
    expect(host.released).toEqual([])
    await first.dispose()
    await settle()
    expect([...host.released].sort()).toEqual(expectedRoutes())
    expect(host.routes).toHaveLength(0)
    // Second cycle against the SAME connection harness: a leaked registration would throw here
    // (the fake carrier refuses a duplicate exact path, like the platform does).
    const second = await ctx.plugin(SkillHistory)
    await settle()
    // `paths` is the registration HISTORY (6 + 6 across two cycles); `routes` is the live registry.
    expect(host.routes.map(route => route.path).sort()).toEqual(expectedRoutes())
    expect(host.paths).toHaveLength(expectedRoutes().length * 2)
    expect(host.routes).toHaveLength(expectedRoutes().length)
    await second.dispose()
    await settle()
    expect(host.routes).toHaveLength(0)
  })

  it('the channel state survives re-preparation (no double-register of the restricted preset)', async () => {
    const ctx = new Context()
    ctx.provide('agentPresets', { list: async () => [], register: async () => async () => {}, readDocument: async () => ({ content: '' }), composedPreset: () => 'standard' })
    ctx.provide('subagents', { getProvider: () => undefined })
    const channel = createSubagentChannel(ctx)
    const first = await channel.prepare({ kind: 'reviewer', allow: ['skill'] })
    const second = await channel.prepare({ kind: 'reviewer', allow: ['skill'] })
    // Both preparations answer the SAME availability — a repeated prepare is not a second registration.
    expect(first).toEqual(second)
    expect(first.kind).toBe('unavailable')
  })
})
