/**
 * Root-level shared/exclusive gate for skill-tree operations.
 *
 * Single-file writes only need the tree to stay structurally stable: they can
 * run under a shared lease plus their per-target lock. Structural operations
 * (archive/restore/consolidate) move or replace whole trees and need an
 * exclusive lease. This gate replaces the implicit "every write is exclusive"
 * per-root serial queue without changing the mutation primitives.
 *
 * The gate is deliberately non-reentrant: a holder must not call read/write
 * again from inside its own section (the queue has no ownership token).
 *
 * @module @deepseek-ai/dsh-evolution-core/skill-root-gate
 */

/** A fair-ish shared/exclusive gate. */
export class SkillRootGate {
  private readers = 0
  private writer = false
  private queue: Array<{ readonly exclusive: boolean; readonly run: () => void }> = []

  /**
   * Run a task under a shared lease.
   * @param task - a single-file mutation that only needs tree stability.
   * @returns the task's value.
   */
  async read<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire(false)
    try {
      return await task()
    } finally {
      this.release(false)
    }
  }

  /**
   * Run a task under an exclusive lease.
   * @param task - a structural mutation that moves/replaces whole trees.
   * @returns the task's value.
   */
  async write<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire(true)
    try {
      return await task()
    } finally {
      this.release(true)
    }
  }

  /** Active shared holders, for leak assertions. */
  get readerCount(): number {
    return this.readers
  }

  /** Whether an exclusive holder is active. */
  get writerActive(): boolean {
    return this.writer
  }

  private acquire(exclusive: boolean): Promise<void> {
    if (!this.writer && (!exclusive || this.readers === 0) && this.queue.length === 0) {
      if (exclusive) this.writer = true
      else this.readers += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.queue.push({ exclusive, run: resolve })
    })
  }

  private release(exclusive: boolean): void {
    if (exclusive) this.writer = false
    else this.readers -= 1
    this.drain()
  }

  private drain(): void {
    while (this.queue.length > 0 && !this.writer && this.readers === 0) {
      const next = this.queue[0]
      if (next === undefined) return
      if (next.exclusive) {
        this.queue.shift()
        this.writer = true
        next.run()
        return
      }
      // Admit the leading reader run together, up to the first writer.
      while (this.queue.length > 0 && this.queue[0]?.exclusive === false) {
        const reader = this.queue.shift()
        if (reader === undefined) break
        this.readers += 1
        reader.run()
      }
      return
    }
  }
}
