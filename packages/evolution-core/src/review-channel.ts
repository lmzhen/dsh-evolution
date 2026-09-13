/**
 * Family-internal mark for the review channel's INJECT delivery (v37 S2.2).
 *
 * With the default `reviewMode: 'inject'` the review prompt runs in the PARENT
 * session, so the parent model's own `skill_manage` calls carry no origin the
 * platform could attribute: `.pinned` and the `.hermes-managed` authorship mark
 * were skipped for exactly the autonomous writes they exist for. The delivery
 * marks the session here and the write path reads the mark.
 *
 * Window: after the review prompt, until the next REAL user message (a
 * `user/message` with `source.kind === 'user'` clears it; plugin-sourced notices
 * never do). Process-wide and keyed by session on purpose — the same
 * "restart is a fresh conversation boundary" discipline as the review plugin's
 * own per-session counters. This module is the ONE owner of the marker.
 * @module @deepseek-ai/dsh-evolution-core/review-channel
 */

/** Session ids currently executing a review prompt, oldest delivery first. */
const markedSessions = new Set<string>()

/**
 * Mark one session as running the review channel's prompt; idempotent, and
 * keyed by session so a mark can never leak into another session.
 * @param sessionId - the session the review prompt was delivered to.
 */
export function markReviewChannel(sessionId: string): void {
  markedSessions.delete(sessionId)
  markedSessions.add(sessionId)
}

/**
 * Clear the mark: the session's next prompt is human input again.
 * @param sessionId - the session whose mark is dropped.
 */
export function clearReviewChannel(sessionId: string): void {
  markedSessions.delete(sessionId)
}

/**
 * Whether this session's current prompt came from the review channel. An
 * execution without a session is never the review channel.
 * @param sessionId - the executing session id, when the caller has one.
 * @returns true only for a marked session.
 */
export function isReviewChannelSession(sessionId: string | undefined): boolean {
  return sessionId !== undefined && markedSessions.has(sessionId)
}

/**
 * Drop marks whose session is gone — a dead session cannot execute a write.
 * @param isAlive - liveness probe for one session id.
 * @returns the number of removed marks.
 */
export function sweepReviewChannelSessions(isAlive: (sessionId: string) => boolean): number {
  let removed = 0
  for (const sessionId of [...markedSessions]) {
    if (isAlive(sessionId)) continue
    markedSessions.delete(sessionId)
    removed += 1
  }
  return removed
}
