// @tier fast
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createReviewChildAgent } from '../src/review-child.ts'

it('replaces only the session and keeps parent methods bound', async () => {
  const parentSession = Session.create(SessionId('parent-review-child'))
  const parent = { id: 'parent', session: parentSession, marker: 'parent', read(): string { return this.marker } }
  const review = await createReviewChildAgent(parent, 'task/with bad chars!')
  expect((review.agent as typeof parent).session).not.toBe(parentSession)
  expect((review.agent as typeof parent).session).toBe(review.session)
  expect(review.session.id).toMatch(/^review-child:task_with_bad_chars_:/)
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

it('fails closed when PTC is requested without a scoped parent', async () => {
  const parent = { id: 'parent', session: Session.create(SessionId('parent-ptc')) }
  await expect(createReviewChildAgent(parent, 'task-ptc', { ptc: true })).rejects.toMatchObject({ code: 'PTC_UNAVAILABLE' })
})

it('removes the scope-owned child session on dispose', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const parentSession = ctx.sessions.create(SessionId('cleanup-parent'))
  const parent = { id: SessionId('cleanup-parent'), session: parentSession, ctx }
  const review = await createReviewChildAgent(parent, 'cleanup-task')
  expect(ctx.sessions.get(review.session.id)).toBeDefined()
  expect(parentSession.seq).toBe(0)
  await review.dispose()
  expect(ctx.sessions.get(review.session.id)).toBeUndefined()
  expect(parentSession.seq).toBe(0)
})
