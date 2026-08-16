import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/index.ts'
import * as Review from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

describe('evolution-review', () => {
  it('defaults review subagent tools to the Anchored Standard discovery pair', () => {
    const value = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: { reviewToolAllow: string[] } } } })['~standard'].validate({}).value
    expect(value.reviewToolAllow).toEqual(['skill', 'skill_search', 'skill_load'])
  })

  it('loads with review disabled', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Review, { reviewEnabled: false })
    expect(ctx.get('agents')).toBeDefined()
  })
})
