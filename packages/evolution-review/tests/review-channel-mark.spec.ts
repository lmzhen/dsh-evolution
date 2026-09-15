/**
 * S2.2 (v37 P1-2): what marks a session as the review channel, and what ends
 * the window.
 *
 * The default 'inject' channel delivers the review PROMPT into the parent
 * session, so every `skill_manage` write the parent model makes for that review
 * carries no distinguishing header origin. The mark set here is what the write
 * path reads; a REAL user message must end the window, and a plugin-sourced
 * notice (including the review prompt itself, and the subagent path's result
 * notice) must never extend it.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { clearReviewChannel, isReviewChannelSession } from '@deepseek-ai/dsh-evolution-core'
import * as Review from '../src/index.ts'

/** Default thresholds (3 tool calls / 200 user chars) reached by the fixture. */
const SURFACE = [
  { role: 'user', content: [{ type: 'text', text: 'u'.repeat(220) }] },
  { role: 'assistant', content: [{ type: 'text', text: 'a'.repeat(520) }] },
]

async function fixture(options: {
  reviewMode?: 'inject' | 'subagent'
  onDelivery?: (message: unknown) => void
  /** S2-8: the platform Inbox view the delivery reads before marking. */
  inbox?: unknown
} = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const session = {
    id: SessionId('s22-review-channel-session'),
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: () => [
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{}' } },
      { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'skill', arguments: '{}' } },
      { type: 'tool/call', data: { turn: 1, step: 3, callId: 'c3', name: 'skill', arguments: '{}' } },
    ],
    deriveMessages: () => SURFACE,
  } as unknown as Session
  const record = (message: unknown): void => { options.onDelivery?.(message) }
  // Prototype methods reaching `this`, like the platform's ReactLoopAgent.
  const agent = new (class {
    readonly id = session.id
    readonly session = session
    inject(message: unknown): void { this.forward(message) }
    followup(message: unknown): void { this.forward(message) }
    forward(message: unknown): void { record(message) }
  })() as unknown as Agent
  if (options.inbox !== undefined) (agent as { inbox?: unknown }).inbox = options.inbox
  ctx.agents.register(agent)
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 1,
    skillInterval: 1,
    ...options.reviewMode === undefined ? {} : { reviewMode: options.reviewMode },
  })
  const emitEnd = (turn: number): void => {
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  const emitUserMessage = (source: unknown): void => {
    ctx.emit('session/event', session, {
      type: 'user/message',
      data: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], source },
    } as never)
  }
  return { ctx, session, emitEnd, emitUserMessage }
}

describe('review channel mark (S2.2, v37 P1-2)', () => {
  it('the inject-mode review PROMPT marks the parent session', async () => {
    const delivered: unknown[] = []
    const { session, emitEnd } = await fixture({ onDelivery: message => delivered.push(message) })
    expect(isReviewChannelSession(session.id)).toBe(false)
    emitEnd(1)
    await vi.waitFor(() => { expect(delivered).toHaveLength(1) })
    const text = (delivered[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ''
    expect(text).toContain('[Auto-review')
    expect(isReviewChannelSession(session.id)).toBe(true)
    clearReviewChannel(session.id)
  })

  it('a REAL user message ends the window; a plugin notice does not', async () => {
    const delivered: unknown[] = []
    const { session, emitEnd, emitUserMessage } = await fixture({ onDelivery: message => delivered.push(message) })
    emitEnd(1)
    await vi.waitFor(() => { expect(delivered).toHaveLength(1) })
    expect(isReviewChannelSession(session.id)).toBe(true)
    // The review prompt itself is a plugin-sourced user/message — replaying it
    // must not clear the very window it opened.
    emitUserMessage({ kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'auto-review' })
    expect(isReviewChannelSession(session.id)).toBe(true)
    // Human input is the platform's `{ kind: 'user' }` attestation.
    emitUserMessage({ kind: 'user' })
    expect(isReviewChannelSession(session.id)).toBe(false)
    // A later review re-opens the window. The delivery woke the agent through
    // `followup`, so the very next boundary is the V7-02 suppressed turn — the
    // one after it delivers again.
    emitEnd(2)
    emitEnd(3)
    await vi.waitFor(() => { expect(delivered).toHaveLength(2) })
    expect(isReviewChannelSession(session.id)).toBe(true)
    clearReviewChannel(session.id)
  })

  it('the subagent path delivers a result NOTICE, which never marks', async () => {
    const delivered: unknown[] = []
    const { ctx, session, emitEnd } = await fixture({ reviewMode: 'subagent', onDelivery: message => delivered.push(message) })
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({ structured: { memoryOps: [], skillOps: [], summary: 'no-op' }, stopReason: 'completed' }),
        dispose: async () => {},
      }),
    })
    ctx.provide('evolutionPolicy', {
      get: () => ({
        reviewMode: 'subagent', substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
        reviewMemoryInterval: 1, reviewSkillInterval: 1, maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
        memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
        memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
      }),
    })
    emitEnd(1)
    await vi.waitFor(() => { expect(delivered.length).toBeGreaterThan(0) })
    const text = (delivered[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ''
    expect(text).toContain('Self-improvement review')
    // The parent never received a review prompt: it is not the review channel,
    // so the user's own subsequent writes keep foreground attribution.
    expect(isReviewChannelSession(session.id)).toBe(false)
  })

  it('S2-8 (FLOW1-3): human input queued AHEAD of the prompt keeps the mark unset, with one diagnostic', async () => {
    const delivered: unknown[] = []
    // A real user row waits in the inbox: the platform claims THAT turn first,
    // so a session-level mark would cover the user's own writes. The row shape
    // is the platform's UserMessage (source.kind === 'user' is its attestation).
    const humanRow = { id: 'm-human', source: { kind: 'user' } }
    const { ctx, session, emitEnd } = await fixture({
      onDelivery: message => delivered.push(message),
      inbox: { nextTurn: [humanRow], nextStep: [] },
    })
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    emitEnd(1)
    await vi.waitFor(() => { expect(delivered).toHaveLength(1) })
    expect(isReviewChannelSession(session.id)).toBe(false)
    const diagnostics = warnSpy.mock.calls.filter(call => String(call[0]).includes('BEHIND queued human input'))
    expect(diagnostics).toHaveLength(1)
    // A later window repeats the decision but not the warning.
    emitEnd(2)
    emitEnd(3)
    await vi.waitFor(() => { expect(delivered).toHaveLength(2) })
    expect(isReviewChannelSession(session.id)).toBe(false)
    expect(warnSpy.mock.calls.filter(call => String(call[0]).includes('BEHIND queued human input'))).toHaveLength(1)
  })

  it('a session that never received a prompt is never marked', async () => {
    const delivered: unknown[] = []
    const { session, emitEnd } = await fixture({ onDelivery: message => delivered.push(message) })
    emitEnd(1)
    await vi.waitFor(() => { expect(delivered).toHaveLength(1) })
    expect(isReviewChannelSession(session.id)).toBe(true)
    expect(isReviewChannelSession('some-other-session')).toBe(false)
    clearReviewChannel(session.id)
  })
})
