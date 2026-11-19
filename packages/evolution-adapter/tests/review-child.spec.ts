// @tier fast
import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createReviewChildAgent } from '../src/review-child.ts'

it('replaces only the session and keeps parent methods bound', () => {
  const parentSession = Session.create(SessionId('parent-review-child'))
  const parent = { id: 'parent', session: parentSession, marker: 'parent', read(): string { return this.marker } }
  const review = createReviewChildAgent(parent, 'task/with bad chars!')
  expect((review.agent as typeof parent).session).not.toBe(parentSession)
  expect((review.agent as typeof parent).session).toBe(review.session)
  expect((review.agent as typeof parent).read()).toBe('parent')
  expect(parentSession.seq).toBe(0)
  review.dispose()
})
