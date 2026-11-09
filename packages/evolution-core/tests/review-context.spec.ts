// @tier fast
import { describe, expect, it } from 'vitest'
import { currentReviewContext, withReviewContext } from '../src/index.ts'
import { resolveExecOrigins } from '../src/skills.ts'

const exec = {
  agent: { session: { id: 'plain-session', header: {} } },
}

describe('review write context', () => {
  it('attributes writes as background_review only inside the context', () => {
    expect(currentReviewContext()).toBeUndefined()
    expect(resolveExecOrigins(exec)).toEqual({ approval: 'foreground', library: 'foreground' })
    const inside = withReviewContext({ reviewId: 'review-1', runId: 'run-1' }, () => {
      expect(currentReviewContext()).toEqual({ reviewId: 'review-1', runId: 'run-1' })
      return resolveExecOrigins(exec)
    })
    expect(inside).toEqual({ approval: 'background_review', library: 'background_review' })
    expect(currentReviewContext()).toBeUndefined()
  })

  it('propagates through an awaited task', async () => {
    const result = await withReviewContext({ reviewId: 'review-2', runId: 'run-2' }, async () => {
      await Promise.resolve()
      return resolveExecOrigins(exec)
    })
    expect(result).toEqual({ approval: 'background_review', library: 'background_review' })
  })
})
