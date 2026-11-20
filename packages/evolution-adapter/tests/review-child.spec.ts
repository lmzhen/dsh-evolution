// @tier fast
import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createReviewChildAgent } from '../src/review-child.ts'

it('replaces only the session and keeps parent methods bound', async () => {
  const parentSession = Session.create(SessionId('parent-review-child'))
  const parent = { id: 'parent', session: parentSession, marker: 'parent', read(): string { return this.marker } }
  const review = await createReviewChildAgent(parent, 'task/with bad chars!')
  expect((review.agent as typeof parent).session).not.toBe(parentSession)
  expect((review.agent as typeof parent).session).toBe(review.session)
  expect((review.agent as typeof parent).read()).toBe('parent')
  expect(parentSession.seq).toBe(0)
  await review.dispose()
})

it('uses the live session store when the parent exposes one', async () => {
  const created: unknown[] = []
  const live = { id: 'live-child', header: { cwd: 'D:/workspace' } }
  const parent = {
    id: 'parent', session: { header: { cwd: 'D:/workspace' } },
    ctx: { sessions: { create: (id: unknown, options: unknown) => { created.push([id, options]); return live } } },
  }
  const review = await createReviewChildAgent(parent, 'task-live')
  expect((review.agent as typeof parent).session).toBe(live)
  expect(created).toHaveLength(1)
  expect((created[0] as [unknown, { meta?: { cwd?: string } }])[1].meta?.cwd).toBe('D:/workspace')
})
