// @tier fast
import { expect, it } from 'vitest'
import { ReviewWriteLocks } from '../src/review-write-locks.ts'

it('releases a waiter when the resource lock is freed', async () => {
  const locks = new ReviewWriteLocks()
  const release = locks.tryAcquire('skill:probe', 'owner-a')
  expect(release).toBeTypeOf('function')
  expect(locks.holder('skill:probe')).toBe('owner-a')
  expect(locks.tryAcquire('skill:probe', 'owner-b')).toBeUndefined()
  const waiting = locks.wait('skill:probe', 5_000, new AbortController().signal)
  release!()
  await expect(waiting).resolves.toBe(true)
  expect(locks.holder('skill:probe')).toBeUndefined()
})

it('returns false when the wait times out', async () => {
  const locks = new ReviewWriteLocks()
  const release = locks.tryAcquire('memory:user', 'owner-a')
  expect(await locks.wait('memory:user', 5, new AbortController().signal)).toBe(false)
  release!()
})

it('dispose releases holders and wakes waiters', async () => {
  const locks = new ReviewWriteLocks()
  locks.tryAcquire('skill:probe', 'owner-a')
  const waiting = locks.wait('skill:probe', 5_000, new AbortController().signal)
  locks.dispose()
  await expect(waiting).resolves.toBe(false)
  expect(locks.tryAcquire('skill:probe', 'owner-b')).toBeUndefined()
})
