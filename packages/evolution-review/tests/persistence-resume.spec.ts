import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionFormatUnsupportedError } from '@deepseek-ai/dsh-session-persistence'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EvolutionPlanAppliedEvent, EvolutionReviewScheduledEvent } from '@deepseek-ai/dsh-evolution-core'
import * as Review from '../src/index.ts'

/**
 * A-line P0-1 acceptance (rc.42): evolution review activity must never enter
 * the session log. The persistence read path refuses any log carrying a type
 * outside the host's KNOWN_SESSION_EVENT_TYPES (assertEventsSupported), and
 * `Session.append` cannot write the `ignorable` marker — so a single
 * `evolution/*` append made whole sessions unresumable. These tests drive the
 * REAL persistence backend (JSONL on a temp dir) through a REAL session:
 * write → dispose (flush) → fresh-context reload, the in-process equivalent
 * of a process restart over one durable log.
 */

const REVIEWER = 'I prefer concise answers and want you to remember that preference. '.repeat(6)

describe('review events never poison the session log (P0-1, rc.42)', () => {
  it('a session whose turn triggered a review stays resumable across a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resume-e2e-'))
    try {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })

      // Plan-outcome consumers ride the cordis event bus (payload v2).
      const scheduled: EvolutionReviewScheduledEvent[] = []
      const applied: EvolutionPlanAppliedEvent[] = []
      ctx.on('evolution/review-scheduled', (event) => { scheduled.push(event) })
      ctx.on('evolution/plan-applied', (event) => { applied.push(event) })

      ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
      ctx.provide('subagents', {
        start: async () => ({
          result: Promise.resolve({
            structured: {
              summary: 'remember the user preference',
              memoryOps: [{
                target: 'memory',
                action: 'add',
                facts: 'User prefers concise answers.',
                evidence: [{ event_seq: 1 }],
              }],
            },
          }),
          localAgent: null,
          dispose: async () => {},
        }),
      })

      await ctx.plugin(Review, {
        reviewEnabled: true,
        reviewMode: 'subagent',
        memoryInterval: 1,
        // High skill interval isolates the memory channel: with both at 1 the
        // deterministic gate returns 'combined' (both signals fire this turn).
        skillInterval: 999,
      })

      const session = ctx.sessions.create(SessionId('evo-resume-e2e'))
      ctx.agents.register({
        id: session.id,
        session,
        ctx,
        inject: () => {},
      } as unknown as Agent)

      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: REVIEWER }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      // onTurnEnd is async-void: poll until the review pipeline reported back.
      const deadline = Date.now() + 5_000
      while (applied.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      expect(applied).toHaveLength(1)
      // Payload v2: process events carry the owning session explicitly.
      expect(applied[0]).toMatchObject({ sessionId: 'evo-resume-e2e', memoryApplied: 1, skillApplied: 0 })
      expect(typeof applied[0]?.planId).toBe('string')
      expect(scheduled).toHaveLength(1)
      expect(scheduled[0]).toMatchObject({ sessionId: 'evo-resume-e2e', kind: 'memory' })

      // The durable log stays native-only — no evolution/* type was appended.
      const types = session.events.map(event => event.type)
      expect(types.some(type => type.startsWith('evolution/'))).toBe(false)

      // Restart equivalence: dispose flushes the write-behind buffer and
      // closes the backend; a fresh context + backend over the same root
      // reload the durable log from disk.
      await fiber.dispose()
      const ctx2 = new Context()
      await mountAgentLoopTestDependencies(ctx2)
      const fiber2 = await ctx2.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      try {
        const inspection = await ctx2.sessionPersistence.load(SessionId('evo-resume-e2e'))
        const reloadedTypes = inspection.events.map(event => event.type)
        expect(reloadedTypes.some(type => type.startsWith('evolution/'))).toBe(false)
        expect(reloadedTypes).toContain('user/message')
        expect(reloadedTypes).toContain('turn/end')
      } finally {
        await fiber2.dispose()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('the pre-rc.42 behavior (appending evolution/*) still breaks resume — regression guard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resume-negative-'))
    try {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })

      const session = ctx.sessions.create(SessionId('evo-resume-negative'))
      // Emulate the OLD (pre-rc.42) behavior deliberately: a direct
      // session.append of an evolution type. The cast is the point — since
      // rc.42 this is not even expressible through typed append.
      const legacyAppend = (type: string, data: unknown): void => {
        ;(session.append as unknown as (t: string, d: unknown) => unknown)(type, data)
      }
      legacyAppend('evolution/plan-applied', { planId: 'legacy', memoryApplied: 1, skillApplied: 0, rejectedOps: 0 })
      session.append('turn/start', { turn: 1 })

      await fiber.dispose()

      const ctx2 = new Context()
      await mountAgentLoopTestDependencies(ctx2)
      const fiber2 = await ctx2.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      try {
        const failure = await ctx2.sessionPersistence.load(SessionId('evo-resume-negative'))
          .then(() => undefined, (error: unknown) => error)
        // The upstream gate is real: the poisoned log is refused wholesale.
        expect(failure).toBeInstanceOf(SessionFormatUnsupportedError)
      } finally {
        await fiber2.dispose()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
