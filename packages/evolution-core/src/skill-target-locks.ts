/**
 * Per-target promise locks for skill writes.
 *
 * The current SkillLibrary serial queue is per root, so writes to different
 * skills serialize even though they share no bytes. This table is the
 * replacement primitive: one tail promise per canonical target key, and a
 * multi-target acquisition that takes keys in lexical order to make deadlock
 * impossible. It is deliberately pure (no IO, no timeout) so the service can
 * compose it with transactIo/HomeFence rather than duplicate lock semantics.
 *
 * @module @deepseek-ai/dsh-evolution-core/skill-target-locks
 */

/** A lock table keyed by canonical skill target key. */
export class SkillTargetLocks {
  private tails = new Map<string, Promise<unknown>>()

  /**
   * Run one task while holding one target key.
   * @param targetKey - canonical skill target key.
   * @param task - the read/compare/write critical section.
   * @returns the task's value.
   */
  async withLock<T>(targetKey: string, task: () => Promise<T>): Promise<T> {
    return await this.withLocks([targetKey], task)
  }

  /**
   * Run one task while holding several target keys.
   *
   * Keys are deduplicated and acquired in lexical order; the caller may pass
   * them in any order. A task must not call {@link withLock}/{@link withLocks}
   * for a key it already holds (the promise chain is not reentrant), so callers
   * should flatten multi-file units into one acquisition.
   * @param targetKeys - canonical target keys touched by the unit.
   * @param task - the unit's read/compare/write critical section.
   * @returns the task's value.
   */
  async withLocks<T>(targetKeys: readonly string[], task: () => Promise<T>): Promise<T> {
    const keys = [...new Set(targetKeys)].sort()
    return await this.acquire(keys, 0, task)
  }

  /** Number of live target queues; exposed for leak assertions in tests. */
  get size(): number {
    return this.tails.size
  }

  private async acquire<T>(keys: readonly string[], index: number, task: () => Promise<T>): Promise<T> {
    const key = keys[index]
    if (key === undefined) return await task()
    const prior = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = prior.then(() => gate)
    this.tails.set(key, tail)
    await prior
    try {
      return await this.acquire(keys, index + 1, task)
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}
