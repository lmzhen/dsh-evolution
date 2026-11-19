/**
 * Process-local review write locks.
 *
 * The SkillLibrary's per-directory lock + CAS is the final correctness layer.
 * This small registry gives the review model the *recoverable* state it needs:
 * a second review writing the same skill/memory resource gets a `resource-busy`
 * tool result instead of racing silently, and `review_wait` can wait for the
 * holder to release before the model re-reads and retries.
 *
 * It is intentionally not durable and does not coordinate foreground writers or
 * other processes; those keep their existing HomeFence/CAS guarantees.
 *
 * @module @deepseek-ai/dsh-evolution-review/review-write-locks
 */

interface Holder {
  readonly owner: string
}

/** One process-local holder per resource plus its waiters. */
export class ReviewWriteLocks {
  private closed = false
  private readonly holders = new Map<string, Holder>()
  private readonly waiters = new Map<string, Set<() => void>>()

  /** @returns the holder when the resource is busy, otherwise undefined. */
  holder(resource: string): string | undefined {
    return this.holders.get(resource)?.owner
  }

  /** Drop all holders and wake waiters; used when the plugin fiber unloads. */
  dispose(): void {
    this.closed = true
    this.holders.clear()
    for (const waiting of this.waiters.values()) for (const wake of waiting) wake()
    this.waiters.clear()
  }

  /**
   * Try to become the holder.
   * @returns the release callback, or undefined when another owner holds it.
   */
  tryAcquire(resource: string, owner: string): (() => void) | undefined {
    if (this.closed || this.holders.has(resource)) return undefined
    this.holders.set(resource, { owner })
    let released = false
    return () => {
      if (released) return
      released = true
      this.holders.delete(resource)
      const waiting = this.waiters.get(resource)
      if (waiting === undefined) return
      this.waiters.delete(resource)
      for (const wake of waiting) wake()
    }
  }

  /**
   * Wait until the resource has no holder.
   * @returns true when free, false on timeout/abort.
   */
  async wait(resource: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    if (this.closed) return false
    if (!this.holders.has(resource)) return true
    if (signal.aborted) return false
    return await new Promise<boolean>((resolve) => {
      let finished = false
      const finish = (value: boolean): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.waiters.get(resource)?.delete(wake)
        if (this.waiters.get(resource)?.size === 0) this.waiters.delete(resource)
        resolve(value)
      }
      const wake = (): void => {
        if (!this.holders.has(resource)) finish(true)
      }
      const waiting = this.waiters.get(resource) ?? new Set<() => void>()
      waiting.add(wake)
      this.waiters.set(resource, waiting)
      const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs))
      const onAbort = (): void => finish(false)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
