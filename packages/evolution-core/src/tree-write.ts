/**
 * G1/1.5 (S7-09): the TYPED critical section around a tree write.
 *
 * The control-plane lock used to wrap a whole pass, LLM call and all: an operator undo/restore waited up to
 * one `curatorReviewTimeoutMs` (~120s) for a review that was merely thinking. The fix is to give the critical
 * section a shape that a review cannot be squeezed into.
 *
 * WHAT THIS TYPE CAN AND CANNOT DO (the plan wording says "cannot be put inside the lock by TYPE" - that is
 * only half true and the half that is false is the half people rely on): a callback is a CLOSURE, so even
 * with `view` as its only parameter it can still reach `this.io` / `this.ctx` / `this.llm` from the enclosing
 * scope. TypeScript cannot stop that, and a criterion claiming it would never go red.
 *
 * What the type DOES give: new code has no other entry - the callback is handed a `SnapshotView` and nothing
 * else, so a phase that needs `io` or `llm` has to stay OUTSIDE and be passed its result in. What the type
 * CANNOT give is covered by the companion source guard (see the family gates): an `io` / `llm` / `this.`
 * / `ctx.` reference inside a `withTreeWrite` callback is a violation, and that guard is the executable form
 * of "cannot be put inside the lock".
 *
 * @module @deepseek-ai/dsh-evolution-core/tree-write
 */

/**
 * What a tree write may see: the mutation surface, and nothing that can think or read the medium directly.
 * Deliberately carries NO `io`, NO `llm`, NO context handle - a phase needing those runs outside the section
 * and hands its plan in.
 */
export interface SnapshotView {
  /** The skill names the snapshot covers, in list order. */
  readonly names: readonly string[]
  /** One skill body, as read when the section opened. Async because the store read is: the view must not
   * pretend a synchronous read of a medium it does not own. */
  read(name: string): Promise<string | undefined>
  /**
   * The ONLY write a section gets: one skill body, by name. Deliberately not an io handle - the point of
   * the view is that a section CAN mutate (that is its job) without also being able to reach the medium,
   * the model, or the context. The implementation is bound by the caller OUTSIDE the callback, so the
   * callback body itself never names `this` / `io` / `llm` (which is what rule N40 checks).
   */
  writeSkill(name: string, content: string): Promise<void>
  /** A record of what this section intends to change, for the audit line. */
  note(text: string): void
}

/**
 * Run one tree-writing section under a caller-owned serial queue, exposing ONLY a {@link SnapshotView}.
 *
 * The queue is passed in rather than owned here: the lock belongs to whoever serializes the control plane
 * (the curator), and a second lock would be a second answer to one question.
 * @param acquire - the caller serial queue (e.g. the curator mutex), returning its release.
 * @param view - what this section sees while it holds the lock.
 * @param fn - the section. It may only use the view.
 * @returns whatever the section returns.
 */
export async function withTreeWrite<T>(
  acquire: () => Promise<() => void>,
  view: SnapshotView,
  fn: (view: SnapshotView) => Promise<T>,
): Promise<T> {
  const release = await acquire()
  try {
    return await fn(view)
  } finally {
    release()
  }
}
