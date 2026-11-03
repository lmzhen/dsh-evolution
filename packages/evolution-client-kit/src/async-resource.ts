/**
 * One read operation's lifecycle: initial load, background refresh, stale-answer
 * suppression, and an explicit failure slot. Consumers derive `empty` from a
 * successful `data` value; this type never conflates "not loaded yet" with
 * "loaded and empty".
 * @module @deepseek-ai/dsh-evolution-client-kit
 */

/** The three settled states; `refreshing` is orthogonal so old data can stay visible. */
export type AsyncStatus = 'loading' | 'ready' | 'error'

/** Immutable snapshot published to render hooks. */
export interface AsyncState<T> {
  readonly status: AsyncStatus
  /** A newer read is in flight while `data` remains the previous successful value. */
  readonly refreshing: boolean
  /** Last successful value; undefined before the first success or after reset. */
  readonly data: T | undefined
  /** Latest failure, cleared by the next successful read. */
  readonly failure: unknown
  /** Monotonic request id; only the latest generation may publish. */
  readonly generation: number
}

/** A loader may use the signal to cancel work when a newer read supersedes it. */
export type AsyncLoader<T> = (signal: AbortSignal) => Promise<T>

/**
 * Serialize one resource's reads without remounting the consumer.
 */
export class AsyncResource<T> {
  #state: AsyncState<T> = Object.freeze({
    status: 'loading' as const,
    refreshing: false,
    data: undefined,
    failure: undefined,
    generation: 0,
  })
  #listeners = new Set<() => void>()
  #generation = 0
  #controller: AbortController | undefined
  #disposed = false

  /** @returns the stable snapshot for uSES. */
  getSnapshot(): AsyncState<T> {
    return this.#state
  }

  /**
   * Observe snapshot replacements.
   * @param listener - called after each publish.
   * @returns the disposer.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Run one read. A prior read is aborted; only this generation may publish.
   * @param load - loader receiving the cancellation signal.
   * @returns settlement after this generation commits or is superseded.
   */
  async load(load: AsyncLoader<T>): Promise<void> {
    if (this.#disposed) return
    const generation = this.#generation + 1
    this.#generation = generation
    this.#controller?.abort()
    const controller = new AbortController()
    this.#controller = controller
    const previous = this.#state
    this.#publish({
      status: previous.data === undefined ? 'loading' : 'ready',
      refreshing: previous.data !== undefined,
      data: previous.data,
      failure: previous.failure,
      generation,
    })
    try {
      const data = await load(controller.signal)
      if (this.#disposed || generation !== this.#generation) return
      this.#publish({ status: 'ready', refreshing: false, data, failure: undefined, generation })
    } catch (failure) {
      if (this.#disposed || generation !== this.#generation || controller.signal.aborted) return
      this.#publish({
        status: previous.data === undefined ? 'error' : 'ready',
        refreshing: false,
        data: previous.data,
        failure,
        generation,
      })
    }
  }

  /** Drop the current value and return to the initial loading state. */
  reset(): void {
    this.#generation += 1
    this.#controller?.abort()
    this.#controller = undefined
    this.#publish({ status: 'loading', refreshing: false, data: undefined, failure: undefined, generation: this.#generation })
  }

  /** Abort the in-flight read and stop notifying. */
  dispose(): void {
    this.#disposed = true
    this.#generation += 1
    this.#controller?.abort()
    this.#controller = undefined
    this.#listeners.clear()
  }

  #publish(state: AsyncState<T>): void {
    this.#state = Object.freeze(state)
    for (const listener of this.#listeners) listener()
  }
}
