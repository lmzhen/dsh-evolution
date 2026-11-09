import { acquireTreeWriteLock, type TreeLock, type TreeLockOptions } from './tree-lock.ts'
import { assertHomeOwner } from './home-owner.ts'

export interface HomeFenceOptions extends TreeLockOptions {}

export interface HomeFenceLease {
  readonly lock: TreeLock
  release(): Promise<void>
}

export class HomeFenceError extends Error {
  readonly reason: 'busy' | 'io'
  constructor(reason: 'busy' | 'io', message: string) {
    super(message)
    this.name = 'HomeFenceError'
    this.reason = reason
  }
}

/** Unlink races on Windows are transient: a virus scanner or a closing handle can hold the
 * lock file for a few milliseconds. Retry only those, and only inside the fence release:
 * the durable write path has its own rename budget and must not inherit lock semantics. */
const RELEASE_RETRY_MS = [25, 50, 100] as const

function transientReleaseError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * One home-level writer queue. It serializes same-process callers before the
 * tree lock, and the tree lock remains the only cross-process guard the current
 * backend can provide (nodeEvolutionIo is single-process).
 *
 * `acquire` is public only for legacy call sites; W0 keeps it usable but makes a
 * failed release advance the queue and poison the fence instead of wedging every
 * later writer. Nested acquisition is not supported: the state layer must reuse
 * the transaction it is already inside (see evolution-state-json appendArchive).
 */
export class HomeFence {
  private tail: Promise<void> = Promise.resolve()
  private poisoned: Error | undefined
  private readonly options: HomeFenceOptions

  constructor(options: HomeFenceOptions) {
    this.options = options
  }

  private async releaseLock(lock: TreeLock): Promise<void> {
    let attempt = 0
    for (;;) {
      try {
        await lock.release()
        return
      } catch (error) {
        if (!transientReleaseError(error) || attempt >= RELEASE_RETRY_MS.length) throw error
        await sleep(RELEASE_RETRY_MS[attempt] ?? 100)
        attempt += 1
      }
    }
  }

  async acquire(): Promise<HomeFenceLease> {
    if (this.poisoned !== undefined) {
      throw new HomeFenceError('io', 'home fence is poisoned after a failed lock release: ' + this.poisoned.message)
    }
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
        await assertHomeOwner(this.options.io, this.options.home)
      } catch (error) {
        await acquired.lock.release().catch(() => {})
        throw error
      }
      let released = false
      return {
        lock: acquired.lock,
        release: async () => {
          if (released) return
          released = true
          let failure: Error | undefined
          try {
            await this.releaseLock(acquired.lock)
          } catch (error) {
            failure = asError(error)
            this.poisoned = failure
          } finally {
            releaseQueue()
          }
          if (failure !== undefined) throw failure
        },
      }
    } catch (error) {
      releaseQueue()
      throw error
    }
  }

  async run<T>(body: (lock: TreeLock) => Promise<T>): Promise<T> {
    const lease = await this.acquire()
    try {
      return await body(lease.lock)
    } finally {
      await lease.release()
    }
  }
}
