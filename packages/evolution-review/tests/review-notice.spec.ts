/**
 * The outstanding-notice state machine (A 组).
 *
 * The plugin used to keep three shadows of one platform fact (queue residency): its own latch, a
 * counter reset at delivery, and a skip-turn map. `review-notice.ts` keeps ONE record instead, fed
 * by the agent-scoped inbox notifications. These cases pin the guard rails that make the later
 * groups safe: adoption survives a restart, a steer's remove-then-reinsert pair keeps the notice
 * outstanding, and an event about an OLDER message can never settle the current one.
 */
import { describe, expect, it } from 'vitest'
import { isReviewNotice, noticeAfter, REVIEW_NOTICE_KIND, REVIEW_NOTICE_LEGACY_KIND, type ReviewNotice } from '../src/review-notice.ts'

/** One notice of ours, in the shape the platform reports (durable source fields only). */
const ours = (id: string) => ({
  id,
  source: { kind: REVIEW_NOTICE_KIND, form: 'notice' },
})

/** A notice this plugin persisted BEFORE the 0.2.x line, read back through the platform's
 * session-format v3→v4 rewrite of the shared `{ kind: 'plugin', plugin }` source. */
const migrated = (id: string) => ({
  id,
  source: { kind: REVIEW_NOTICE_LEGACY_KIND, form: 'notice' },
})

/** A human message, or another plugin's notice: not ours to track. */
const foreign = (id: string, source: Record<string, string> = { kind: 'user' }) => ({ id, source })

describe('one outstanding review notice per session (A)', () => {
  it('recognizes its own notices by the durable source, not by a remembered id', () => {
    expect(isReviewNotice(ours('m1'))).toBe(true)
    expect(isReviewNotice(migrated('m1')), 'a pre-0.2.x notice stays ours through the v3→v4 rewrite').toBe(true)
    expect(isReviewNotice(foreign('m1'))).toBe(false)
    expect(isReviewNotice(foreign('m1', { kind: 'hooks-codex', form: 'notice' }))).toBe(false)
    expect(isReviewNotice(foreign('m1', { kind: REVIEW_NOTICE_KIND, form: 'relay' }))).toBe(false)
    expect(isReviewNotice({ id: 'm1' })).toBe(false)
  })

  it('adopts a notice the queue accepted, and follows the turn that claims it', () => {
    const inserted = noticeAfter(undefined, { kind: 'inserted', message: ours('m1') })
    expect(inserted).toEqual({ notice: { messageId: 'm1', turn: null }, settled: false })
    const claimed = noticeAfter(inserted.notice, { kind: 'claimed', message: ours('m1'), turn: 7 })
    expect(claimed).toEqual({ notice: { messageId: 'm1', turn: 7 }, settled: false })
  })

  it('adopts again after a restart forgot the record — the source is the durable half', () => {
    const claimed = noticeAfter(undefined, { kind: 'claimed', message: ours('m1'), turn: 3 })
    expect(claimed.notice).toEqual({ messageId: 'm1', turn: 3 })
    const reinserted = noticeAfter(undefined, { kind: 'inserted', message: ours('m1') })
    expect(reinserted.notice).toEqual({ messageId: 'm1', turn: null })
  })

  it('settles when the queue drops it, and only for the notice being tracked', () => {
    const current: ReviewNotice = { messageId: 'm2', turn: null }
    // A removal of an OLDER notice must not reset the current window.
    expect(noticeAfter(current, { kind: 'discarded', message: ours('m1') }))
      .toEqual({ notice: current, settled: false })
    expect(noticeAfter(current, { kind: 'discarded', message: ours('m2') }))
      .toEqual({ notice: undefined, settled: true })
    // Nothing tracked: this discard is about a notice whose `inserted` we never saw (late mount) —
    // it must settle too, or that window would never restart.
    expect(noticeAfter(undefined, { kind: 'discarded', message: ours('m2') }))
      .toEqual({ notice: undefined, settled: true })
  })

  it('keeps a steered notice outstanding: remove and reinsert are one gesture', () => {
    // The client's steer path is `inbox.remove(id)` followed by `agent.steer(message)`, which
    // re-inserts the SAME id into next-step — so the pair must leave exactly one record.
    const tracked: ReviewNotice = { messageId: 'm1', turn: null }
    const removed = noticeAfter(tracked, { kind: 'discarded', message: ours('m1') })
    expect(removed).toEqual({ notice: undefined, settled: true })
    const reinserted = noticeAfter(removed.notice, { kind: 'inserted', message: ours('m1') })
    expect(reinserted).toEqual({ notice: { messageId: 'm1', turn: null }, settled: false })
  })

  it('ignores every event that is not about one of our notices', () => {
    const current: ReviewNotice = { messageId: 'm1', turn: 2 }
    const kinds = ['inserted', 'claimed', 'discarded'] as const
    for (const kind of kinds) {
      expect(noticeAfter(current, { kind, message: foreign('h1'), turn: 9 })).toEqual({ notice: current, settled: false })
    }
  })
})
