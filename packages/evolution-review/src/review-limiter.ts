/**
 * Process-local bound on concurrent AUX reviews.
 *
 * The family deliberately keeps this small: one semaphore for the plugin
 * instance, no per-session or weighted fairness. A review waits for a slot
 * before its first model request; the bounded queue is what keeps a burst of
 * sessions from opening unbounded LLM streams.
 *
 * @module @deepseek-ai/dsh-evolution-review/review-limiter
 */

/** A tiny FIFO semaphore whose waiters can be aborted by unload/timeout. */
export class ReviewLimiter {
  private active = 0
  private closed = false
  private readonly waiters: Array<{ resolve: (release: (() => void) | undefined) => void; signal?: AbortSignal; onAbort?: () => void }> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('review limiter limit must be a positive integer')
  }

  /** Wait for a slot; undefined means the wait was aborted or the limiter closed. */
  async acquire(signal?: AbortSignal): Promise<(() => void) | undefined> {
    if (this.closed || signal?.aborted === true) return undefined
    if (this.active < this.limit) {
      this.active += 1
      return this.releaseOnce()
    }
    return await new Promise<(() => void) | undefined>((resolve) => {
      const waiter: { resolve: (release: (() => void) | undefined) => void; signal?: AbortSignal; onAbort?: () => void } = { resolve }
      if (signal !== undefined) {
        waiter.signal = signal
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          resolve(undefined)
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
    })
  }

  dispose(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.signal !== undefined && waiter.onAbort !== undefined) waiter.signal.removeEventListener('abort', waiter.onAbort)
      waiter.resolve(undefined)
    }
  }

  private releaseOnce(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      const waiter = this.waiters.shift()
      if (waiter === undefined) return
      if (waiter.signal !== undefined && waiter.onAbort !== undefined) waiter.signal.removeEventListener('abort', waiter.onAbort)
      this.active += 1
      waiter.resolve(this.releaseOnce())
    }
  }
}
