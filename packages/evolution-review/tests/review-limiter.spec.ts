// @tier fast
import { expect, it } from 'vitest'
import { ReviewLimiter } from '../src/review-limiter.ts'

it('bounds concurrent reviews and hands slots to waiters', async () => {
  const limiter = new ReviewLimiter(1)
  const first = await limiter.acquire()
  expect(first).toBeTypeOf('function')
  const second = limiter.acquire()
  setTimeout(() => first!(), 0)
  const release = await second
  expect(release).toBeTypeOf('function')
  release!()
  limiter.dispose()
})

it('aborts a queued review without leaking a slot', async () => {
  const limiter = new ReviewLimiter(1)
  const hold = await limiter.acquire()
  const controller = new AbortController()
  const queued = limiter.acquire(controller.signal)
  controller.abort()
  await expect(queued).resolves.toBeUndefined()
  hold!()
  limiter.dispose()
})
