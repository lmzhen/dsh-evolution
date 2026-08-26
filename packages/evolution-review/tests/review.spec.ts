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

  it('defaults the completion channel to both with a long-conversation threshold', () => {
    const value = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: { skillReviewTrigger: string; skillReviewCompletionMinToolCalls: number } } } })['~standard'].validate({}).value
    expect(value.skillReviewTrigger).toBe('both')
    expect(value.skillReviewCompletionMinToolCalls).toBe(20)
  })

  it('completion fires once for a completed turn on a proven-long session', () => {
    expect(Review.shouldCompletionReview({ kind: 'completed' }, 20, 20)).toBe(true)
    // Interrupted/error turns are not task completion.
    expect(Review.shouldCompletionReview({ kind: 'interrupted' }, 20, 20)).toBe(false)
    expect(Review.shouldCompletionReview({ kind: 'error' }, 20, 20)).toBe(false)
    // The long-conversation gate protects short sessions.
    expect(Review.shouldCompletionReview({ kind: 'completed' }, 19, 20)).toBe(false)
    expect(Review.shouldCompletionReview(undefined, 99, 20)).toBe(false)
  })

  it('read-mark keeps unread patch targets out of the background review', () => {
    const ops = [
      { action: 'patch', name: 'unread-skill' },
      { action: 'patch', name: 'read-skill' },
      { action: 'update', name: 'unread-skill' },
      { action: 'create', name: 'brand-new-skill' },
      { action: 'patch' },
    ]
    const dropped = Review.filterUnreadSkillOps(ops, new Set(['read-skill']))
    expect(dropped).toBe(2)
    expect(ops.map(op => op.name).filter(Boolean)).toEqual(['read-skill', 'brand-new-skill'])
  })
})
