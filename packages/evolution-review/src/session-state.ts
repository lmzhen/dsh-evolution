/**
 * A registry of one plugin instance's session-keyed collections.
 *
 * P1-9 (S2-2): the review plugin kept eight per-session maps and cleared them
 * from a hand-written list inside its dispose hook. The list drifted — the
 * 0.3.38-0.3.42 additions (pendingCadenceReviews, pendingCadenceWarned,
 * skipNextCadenceFire, cadenceResetWarned) were missing from it until V7-16 —
 * because nothing tied a declaration to its cleanup. Registering at the
 * declaration site removes the list: a collection clears because it was
 * registered, and tests/session-state-ownership.spec.ts fails when a new
 * `new Map<SessionId, …>` skips the registry.
 *
 * Deliberately package-local: evolution-review is the only current consumer
 * (commands holds no per-session state, and state-json's warn dedupe sets are
 * process-lifetime by design). Promote it to evolution-core when a second
 * package needs the same registration discipline.
 */
export class SessionScopedState {
  private readonly registered: Array<{ key: string; collection: { clear(): void } }> = []

  /**
   * Register a collection and return it, so declaration and registration stay
   * one statement.
   *
   * @param key - the declaring variable name; also the diagnostic name.
   * @param collection - any collection exposing clear().
   * @returns the same collection.
   */
  add<T extends { clear(): void }>(key: string, collection: T): T {
    if (this.registered.some(entry => entry.key === key)) {
      throw new Error(`dsh-evolution-review: session state "${key}" is registered twice`)
    }
    this.registered.push({ key, collection })
    return collection
  }

  /** Registered keys in registration order (diagnostics and the ownership spec). */
  keys(): string[] {
    return this.registered.map(entry => entry.key)
  }

  /** Clear every registered collection. Idempotent; safe on a partially used mount. */
  dispose(): void {
    for (const entry of this.registered) entry.collection.clear()
  }
}
