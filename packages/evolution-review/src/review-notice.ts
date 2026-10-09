/**
 * The one outstanding review notice of one session, as a pure state machine (A 组).
 *
 * Why this exists: the plugin used to model "have I already asked?" with its own latch and to
 * reset the cadence counter at DELIVERY — three shadows of one fact the platform already owns
 * (the agent's pending-message queue). This module keeps ONE record instead: whether a notice of
 * ours is still outstanding, and which turn took it. The queue's own lifecycle events feed it, so
 * the plugin never invents a second account of the same fact.
 *
 * The events are the agent-scoped inbox notifications: `inserted` (a message entered the queue —
 * which is also what a steer does when it re-inserts the same message into `next-step`),
 * `claimed` (a turn took it, payload carries that turn) and `discarded` (the queue dropped it
 * unrun: removed, cleared, or replaced).
 *
 * Invariants: the record is per session and there is AT MOST ONE (one outstanding review at a
 * time); only the notice we were tracking can settle — an event about some other of our messages
 * leaves the record untouched; nothing here touches counters, io or the locale, which keeps the
 * whole rule testable without a host.
 * @module @deepseek-ai/dsh-evolution-review/review-notice
 */

/** The producer-owned source kind every notice of this plugin carries (0.2.x: each
 * producer declares its own kind; there is no shared catch-all `plugin` kind). */
export const REVIEW_NOTICE_KIND = 'evolution-review'

/**
 * The kind a notice persisted before the 0.2.x line reads back as.
 *
 * The platform's session-format v3→v4 migration rewrites the released shared
 * `{ kind: 'plugin', plugin }` source into `plugin:<plugin>` for a producer its own tables do
 * not know (session-format-v3-to-v4/src/sources.ts:59-65, :74-90), so the notices an
 * upgraded session already carries must still be recognized — otherwise the window they
 * belonged to would be delivered a second time.
 */
export const REVIEW_NOTICE_LEGACY_KIND = 'plugin:dsh-evolution-review'

/** T3-01/A29: the summary every RESULT notification carries ("what the review did"). A result notice
 * is NOT a review prompt: it occupies no window and must never refuse the next cadence flush — but it
 * shares the kind AND the form (the platform types `form` as the literal 'notice'), so this summary is
 * the only field that tells the two apart, for new notices and for the ones an older build persisted. */
export const REVIEW_RESULT_SUMMARY = 'self-improvement review'

/** The subset of a platform message this module reads. */
export interface NoticeMessage {
  readonly id: string
  readonly source?: {
    readonly kind?: string
    readonly form?: string
    /** Present on both shapes this plugin delivers (a prompt and a result notice); the result
     * summary is what identifies a LEGACY result notice, see {@link REVIEW_RESULT_SUMMARY}. */
    readonly summary?: string
  } | undefined
}

/** One delivered notice that has not settled yet. */
export interface ReviewNotice {
  /** The platform identity of the delivered message. */
  readonly messageId: string
  /** The turn that claimed it, or null while it is still waiting in the queue. */
  readonly turn: number | null
}

/** The three inbox notifications that move a notice from delivery to settlement. */
export type NoticeEventKind = 'inserted' | 'claimed' | 'discarded'

/** What one inbox event did to the outstanding notice. */
export interface NoticeOutcome {
  /** The record that stands afterwards, or undefined when nothing is outstanding. */
  readonly notice: ReviewNotice | undefined
  /** Whether this event settled the notice we were tracking (the counter resets here). */
  readonly settled: boolean
}

/**
 * Whether a message is a notice this plugin delivered, judged only by durable source fields.
 *
 * The source — not the record — is what survives a restart, so a rebuild reads the same facts it
 * would have read live.
 * @param message - the message the platform reported.
 * @returns true only for this plugin's own notices.
 */
export function isReviewNotice(message: NoticeMessage): boolean {
  const source = message.source
  if (source?.form !== 'notice') return false
  if (source.kind !== REVIEW_NOTICE_KIND && source.kind !== REVIEW_NOTICE_LEGACY_KIND) return false
  // T3-01/A29: the RESULT notification shares this identity, so the platform's `inserted` event for
  // one was adopted as an outstanding review prompt — the next cadence flush was then refused (with a
  // warning that was not true) and the review silently slipped a boundary. The result summary is what
  // says which shape this is; the review prompts carry their own (cadence / completion) summaries.
  return source.summary !== REVIEW_RESULT_SUMMARY
}

/**
 * Fold one inbox event into the session's outstanding notice.
 *
 * `inserted` and `claimed` ADOPT the message (last wins): a message of ours that the queue holds or
 * a turn is running is outstanding by definition, whether or not a record survived a restart.
 * `discarded` settles whatever we were tracking — or nothing, when the delivery's `inserted` was
 * never seen — and ignores only the stale case: a record naming a DIFFERENT message means the
 * current notice is still queued, so that window must not be reset.
 * @param current - the session's record before this event.
 * @param event - the inbox notification and its message.
 * @returns the record afterwards, and whether the tracked notice settled.
 */
export function noticeAfter(
  current: ReviewNotice | undefined,
  event: { readonly kind: NoticeEventKind; readonly message: NoticeMessage; readonly turn?: number | undefined },
): NoticeOutcome {
  if (!isReviewNotice(event.message)) return { notice: current, settled: false }
  switch (event.kind) {
    case 'inserted':
      return { notice: { messageId: event.message.id, turn: null }, settled: false }
    case 'claimed':
      return { notice: { messageId: event.message.id, turn: event.turn ?? null }, settled: false }
    case 'discarded':
      // A record naming a DIFFERENT message is a stale event (the current notice is still queued):
      // ignore it. With no record at all, this discard IS about one of our notices — the one whose
      // `inserted` we never saw (a late mount, or a host that does not emit it) — and it must settle
      // too, or the window it belonged to would never restart.
      if (current !== undefined && current.messageId !== event.message.id) return { notice: current, settled: false }
      return { notice: undefined, settled: true }
  }
}
