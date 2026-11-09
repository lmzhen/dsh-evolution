import { acquireTreeWriteLock, type TreeLock, type TreeLockOptions } from './tree-lock.ts'

export interface HomeFenceOptions extends TreeLockOptions {}

export class HomeFenceError extends Error {
  readonly reason: 'busy' | 'io'
  constructor(reason: 'busy' | 'io', message: string) {
    super(message)
    this.name = 'HomeFenceError'
    this.reason = reason
  }
}

/**
 * One home-level writer queue. It serializes same-process callers before the
 * tree lock, and the tree lock remains the only cross-process guard the current
 * backend can provide (nodeEvolutionIo is single-process).
 */
export class HomeFence {
  private tail: Promise<void> = Promise.resolve()
  private readonly options: HomeFenceOptions

  constructor(options: HomeFenceOptions) {
    this.options = options
  }

  async run<T>(body: (lock: TreeLock) => Promise<T>): Promise<T> {
    const previous = this.tail
    let releaseQueue: () => void = () => {}
    this.tail = new Promise<void>(resolve => { releaseQueue = resolve })
    await previous
    try {
      const acquired = await acquireTreeWriteLock(this.options)
      if (!acquired.ok) {
        throw new HomeFenceError(acquired.reason, acquired.message ?? 'home fence is ' + acquired.reason)
      }
      try {
        return await body(acquired.lock)
      } finally {
        await acquired.lock.release()
      }
    } finally {
      releaseQueue()
    }
  }
}
