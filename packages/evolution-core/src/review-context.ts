/**
 * Plugin-local review execution context.
 *
 * This is deliberately not a platform API: the family review executor wraps one
 * bounded tool loop, and the write tools read the context to attribute writes as
 * background_review without relying on a Session header or a global mark.
 *
 * @module @deepseek-ai/dsh-evolution-core/review-context
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** One review run's write provenance. */
export interface ReviewExecutionContext {
  /** Stable ReviewRun id used by audit and actions. */
  readonly reviewId: string
  /** Execution id; currently the same run id. */
  readonly runId: string
}

const STORAGE_KEY = Symbol.for('dsh.evolution.review-context.storage')
const registry = globalThis as typeof globalThis & { [STORAGE_KEY]?: AsyncLocalStorage<ReviewExecutionContext> }
const storage = registry[STORAGE_KEY] ?? (registry[STORAGE_KEY] = new AsyncLocalStorage<ReviewExecutionContext>())

/**
 * Run one review tool loop under the review write context.
 * @param context - review/run identity.
 * @param task - loop body; nested tool executions inherit the context.
 * @returns the task's value.
 */
export function withReviewContext<T>(context: ReviewExecutionContext, task: () => T): T {
  return storage.run(Object.freeze({ ...context }), task)
}

/**
 * The active review context, when the current async execution belongs to a review loop.
 * @returns the frozen context, or undefined outside a review loop.
 */
export function currentReviewContext(): ReviewExecutionContext | undefined {
  return storage.getStore()
}
