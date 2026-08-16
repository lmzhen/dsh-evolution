import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Feedback from '../src/index.ts'

describe('evolution-feedback', () => {
  it('computes quality score from positive and negative feedback', async () => {
    const ctx = new Context()
    await ctx.plugin(Feedback, {})
    ctx.evolutionFeedback.record('python-testing', 'positive')
    ctx.evolutionFeedback.record('python-testing', 'positive')
    ctx.evolutionFeedback.record('python-testing', 'negative')
    expect(ctx.evolutionFeedback.score('python-testing')).toBeCloseTo(1 / 3)
  })
})
