import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Review from '../src/index.ts'

const REVIEWER = 'I prefer concise answers and want you to remember that preference. '.repeat(6)

describe('evolution-review lifecycle guards', () => {
  it('disposes the subagent run when its result rejects (P1-3)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)

    let disposed = 0
    ctx.provide('subagents', {
      start: async () => ({
        // Emulates a timed-out / aborted child: the run result rejects.
        result: Promise.reject(new Error('simulated review timeout')),
        localAgent: null,
        dispose: async () => { disposed += 1 },
      }),
    })

    const injected: Array<{ content: Array<{ type: string; text?: string }> }> = []
    await ctx.plugin(Review, {
      reviewEnabled: true,
      reviewMode: 'subagent',
      memoryInterval: 1,
      // Isolate the memory channel (with both at 1 the gate returns 'combined').
      skillInterval: 999,
    })

    const session = ctx.sessions.create(SessionId('review-dispose'))
    ctx.agents.register({
      id: session.id,
      session,
      ctx,
      inject: (message: unknown) => { injected.push(message as (typeof injected)[number]) },
      followup: (message: unknown) => { injected.push(message as (typeof injected)[number]) },
    } as unknown as Agent)

    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: REVIEWER }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // V6-53 (0.3.39): the threshold turn only STASHES the review — the subagent
    // runs at the NEXT completed boundary (the flush). Append a second
    // completed turn/end to drive the flush.
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    // V6-53 (0.3.39): the review runs at the END-flush — settle, then assert the
    // dispose guarantee (the rejected run is still disposed exactly once).
    await new Promise(resolve => setTimeout(resolve, 150))
    // The dispose guarantee is the point of this test: the rejected run must
    // still be disposed exactly once, even though the pipeline failed.
    expect(disposed).toBe(1)
    // The failure falls back to the synchronous inject path AT the end-flush.
    expect(injected).toHaveLength(1)
    const text = injected[0]?.content.find(block => block.type === 'text')?.text ?? ''
    expect(text).toContain('Auto-review')
  })

  it('sweepDeadSessionEntries drops only entries whose session is gone (P1-10)', () => {
    const alive = (id: string): boolean => id === 'live-session'
    const map = new Map([['live-session', 1], ['dead-session', 2]])
    const set = new Set(['live-session', 'dead-session'])
    expect(Review.sweepDeadSessionEntries(map, alive)).toBe(1)
    expect(map.has('live-session')).toBe(true)
    expect(map.has('dead-session')).toBe(false)
    expect(Review.sweepDeadSessionEntries(set, alive)).toBe(1)
    expect([...set]).toEqual(['live-session'])
    // A second sweep over an already-clean collection is a no-op.
    expect(Review.sweepDeadSessionEntries(map, alive)).toBe(0)
  })

  it('PLAN S4.1 (2026-09-16, P2-10): the counter sweep clears dead sessions\u2019 lastTurnStart and keeps live ones', { timeout: 30_000 }, async () => {
    // lastTurnStart is closure-private, so the assertion goes through its only
    // reader: the woken-turn cadence suppression records
    // `{ afterTurn: lastTurnStart.get(id) ?? -1 }` at delivery time. A session
    // that is DEAD at sweep time must come back with the FRESH -1 baseline
    // (its stale entry swept), while a LIVE session keeps its real turn number
    // (S2-9's busy-period boundary must stay unsuppressed after a sweep).
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    ctx.provide('evolutionPolicy', {
      get: () => ({
        reviewMode: 'inject' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
        reviewMemoryInterval: 1, reviewSkillInterval: 999,
        maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
        memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
        memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
      }),
    })
    const wakes = new Map<string, number>()
    const sessions = new Map<string, Session>()
    const makeSession = (label: string): Session => {
      const session = {
        id: SessionId(label),
        seq: 1,
        header: { origin: undefined },
        snapshotEvents: (): unknown[] => [{
          type: 'tool/call',
          data: { turn: 0, step: 2, callId: `${label}-0`, name: 'skill', arguments: '{}' },
        }],
        deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
      } as unknown as Session
      sessions.set(label, session)
      return session
    }
    const emit = (label: string, type: 'turn/start' | 'turn/end', data: Record<string, unknown>): void => {
      ctx.emit('session/event', sessions.get(label) as Session, { type, data } as never)
    }
    const registerAgent = (label: string): void => {
      ctx.agents.register({
        id: SessionId(label),
        session: sessions.get(label),
        ctx,
        followup: (): void => { wakes.set(label, (wakes.get(label) ?? 0) + 1) },
        inject: (): void => { wakes.set(label, (wakes.get(label) ?? 0) + 1) },
      } as unknown as Agent)
    }
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 999 })

    // 128 turn/start sessions fill the sweep threshold: live-s (agent kept
    // registered the whole time), resurrect (agentless until AFTER the sweep)
    // and 126 fillers.
    makeSession('sweep-live')
    registerAgent('sweep-live')
    makeSession('sweep-resurrect')
    emit('sweep-live', 'turn/start', { turn: 5 })
    emit('sweep-resurrect', 'turn/start', { turn: 5 })
    for (let index = 0; index < 126; index += 1) {
      const label = `sweep-filler-${index}`
      makeSession(label)
      emit(label, 'turn/start', { turn: 1 })
    }
    // Crossing the threshold: the next turn/end runs the sweep. `sweep-resurrect`
    // is agentless right now — WITH the fix its lastTurnStart entry is dropped;
    // without it the stale `5` survives to poison the suppression below.
    makeSession('sweep-filler-trigger')
    emit('sweep-filler-trigger', 'turn/end', { turn: 1, reason: { kind: 'completed' } })

    // Resurrect: an agent re-registers and delivers WITHOUT a fresh turn/start
    // (the stale map must not answer for it). Delivery 1 records afterTurn.
    registerAgent('sweep-resurrect')
    emit('sweep-resurrect', 'turn/end', { turn: 7, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(wakes.get('sweep-resurrect')).toBe(1) }, { timeout: 15_000 })
    // A busy-period-numbered boundary (turn 5, <= the STALE entry, but a fresh
    // -1 baseline suppresses it) must not fire a second review.
    emit('sweep-resurrect', 'turn/end', { turn: 5, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(wakes.get('sweep-resurrect')).toBe(1)

    // The live session's entry survived the sweep: its real afterTurn (5)
    // leaves the busy-period boundary UNSUPPRESSED — exactly one more review.
    emit('sweep-live', 'turn/end', { turn: 5, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(wakes.get('sweep-live')).toBe(1) }, { timeout: 15_000 })
    emit('sweep-live', 'turn/end', { turn: 5, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(wakes.get('sweep-live')).toBe(2) }, { timeout: 15_000 })
  })
})
