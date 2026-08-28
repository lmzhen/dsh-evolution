import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
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
    } as unknown as Agent)

    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: REVIEWER }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // onTurnEnd is async-void: poll for the fallback inject (post-catch).
    const deadline = Date.now() + 5_000
    while (injected.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    // The dispose guarantee is the point of this test: the rejected run must
    // still be disposed exactly once, even though the pipeline failed.
    expect(disposed).toBe(1)
    // The failure falls back to the synchronous inject path.
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
})
