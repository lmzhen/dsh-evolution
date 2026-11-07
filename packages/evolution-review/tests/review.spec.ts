// @tier ci-only
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { apply as mountRuntime } from '@deepseek-ai/dsh-evolution-core/runtime'
import * as Review from '../src/index.ts'

describe('evolution-review', () => {
  it('loads with review disabled', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    if (ctx.get('sessionProjections') === undefined) new SessionProjectionRegistry(ctx)
    await ctx.plugin(mountRuntime)
    await ctx.plugin(Review, { reviewEnabled: false })
    expect(ctx.get('agents')).toBeDefined()
  })
})
