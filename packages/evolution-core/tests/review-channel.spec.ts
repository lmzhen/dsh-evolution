/**
 * S2.2 (v37 P1-2): the review channel's session mark.
 *
 * With the default `reviewMode: 'inject'` the review prompt runs in the PARENT
 * session, whose header carries no origin — the platform therefore reports the
 * parent model's `skill_manage` writes as `'foreground'`, and the `.pinned`
 * freeze / `.hermes-managed` authorship mark were skipped for exactly the
 * autonomous writes they exist for. This module is the single owner of the
 * mark that closes that gap; these cases pin its lifecycle contract.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { clearReviewChannel, isReviewChannelSession, markReviewChannel, sweepReviewChannelSessions } from '@deepseek-ai/dsh-evolution-core'

const SESSION = 'review-channel-session'
const OTHER = 'review-channel-other-session'

afterEach(() => {
  // Module state outlives a test: an unmarked table is the default state.
  clearReviewChannel(SESSION)
  clearReviewChannel(OTHER)
  clearReviewChannel('swept-dead')
})

describe('review-channel mark (S2.2, v37 P1-2)', () => {
  it('a session is NOT the review channel until its prompt is delivered', () => {
    expect(isReviewChannelSession(SESSION)).toBe(false)
    // An execution without a session (the tool contract allows it) is never it.
    expect(isReviewChannelSession(undefined)).toBe(false)
    markReviewChannel(SESSION)
    expect(isReviewChannelSession(SESSION)).toBe(true)
  })

  it('clearing returns the session to ordinary attribution', () => {
    markReviewChannel(SESSION)
    clearReviewChannel(SESSION)
    expect(isReviewChannelSession(SESSION)).toBe(false)
    // Clearing an unmarked session is a no-op, not an error.
    clearReviewChannel(SESSION)
    expect(isReviewChannelSession(SESSION)).toBe(false)
  })

  it('never leaks across sessions', () => {
    markReviewChannel(SESSION)
    expect(isReviewChannelSession(OTHER)).toBe(false)
    markReviewChannel(OTHER)
    clearReviewChannel(SESSION)
    expect(isReviewChannelSession(OTHER)).toBe(true)
  })

  it('re-marking an already marked session is idempotent', () => {
    markReviewChannel(SESSION)
    markReviewChannel(SESSION)
    clearReviewChannel(SESSION)
    expect(isReviewChannelSession(SESSION)).toBe(false)
  })

  it('the sweep drops dead sessions only', () => {
    markReviewChannel(SESSION)
    markReviewChannel('swept-dead')
    const removed = sweepReviewChannelSessions(id => id !== 'swept-dead')
    expect(removed).toBe(1)
    expect(isReviewChannelSession(SESSION)).toBe(true)
    expect(isReviewChannelSession('swept-dead')).toBe(false)
  })
})
