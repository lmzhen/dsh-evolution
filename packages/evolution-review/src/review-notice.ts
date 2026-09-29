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

/** The plugin id every notice of this plugin carries in its durable message source. */
export const REVIEW_NOTICE_PLUGIN = 'dsh-evolution-review'

/** The subset of a platform message this module reads. */
export interface NoticeMessage {
  readonly id: string
  readonly source?: {
    readonly kind?: string
    readonly plugin?: string
    readonly form?: string
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
  return source?.kind === 'plugin'
    && source.plugin === REVIEW_NOTICE_PLUGIN
    && source.form === 'notice'
}

/**
 * Fold one inbox event into the session's outstanding notice.
 *
 * `inserted` and `claimed` ADOPT the message (last wins): a message of ours that the queue holds or
 * a turn is running is outstanding by definition, whether or not a record survived a restart.
 * `discarded` settles only the notice we were tracking: an event about an older message must not
 * reset a window that belongs to the current one.
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
      if (current?.messageId !== event.message.id) return { notice: current, settled: false }
      return { notice: undefined, settled: true }
  }
}
