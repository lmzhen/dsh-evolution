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
 * the session log. A build refuses to interpret a stored log carrying a type
 * outside its generated KNOWN_SESSION_EVENT_TYPES set unless the event is
 * marked `ignorable: true` (`validateStoredEvents`), and `Session.append`
 * cannot write that marker — so one `evolution/*` append makes the whole
 * session unreadable.
 *
 * v33 (0.1.5) rewrote how that refusal is reached, so these tests write the
 * durable log through the platform's own storage handle instead of relying on
 * a bare `ctx.sessions.create()` append to persist: 0.1.5 makes the agent loop
 * the owner of the write handle (`agent-loop/src/index.ts` opens
 * `sessionPersistence.open(id, 'write')`), and the removed
 * `SessionPersistence.load()` is replaced by a read handle whose `read()`
 * runs the same validator.
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
      // V6-53 (0.3.39): the threshold turn only STASHES the kind — the review
      // subagent runs at the NEXT completed boundary (the flush).
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

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

      // The session log stays native-only — no evolution/* type was appended.
      const types = session.snapshotEvents().map(event => event.type)
      expect(types.some(type => type.startsWith('evolution/'))).toBe(false)

      // Persist exactly that log through the platform's write handle: this is
      // the durable artifact a restart replays (0.1.5: the loop owns the handle).
      const handle = await ctx.sessionPersistence.create(session.header)
      await handle.append([...session.snapshotEvents()])
      await handle.close()

      // Restart equivalence: a fresh context + backend over the same root
      // reload the durable log from disk.
      await fiber.dispose()
      const ctx2 = new Context()
      await mountAgentLoopTestDependencies(ctx2)
      const fiber2 = await ctx2.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      try {
        const reader = await ctx2.sessionPersistence.open(SessionId('evo-resume-e2e'), 'read')
        try {
          const inspection = await reader.read()
          const reloadedTypes = inspection.events.map(event => event.type)
          expect(reloadedTypes.some(type => type.startsWith('evolution/'))).toBe(false)
          expect(reloadedTypes).toContain('user/message')
          expect(reloadedTypes).toContain('turn/end')
        } finally {
          await reader.close()
        }
      } finally {
        await fiber2.dispose()
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('the pre-rc.42 behavior (appending evolution/*) still breaks resume — regression guard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resume-negative-'))
    try {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })

      const session = ctx.sessions.create(SessionId('evo-resume-negative'))
      const handle = await ctx.sessionPersistence.create(session.header)
      await handle.append([{ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } } as never])
      // Emulate the OLD (pre-rc.42) behavior deliberately: a direct durable
      // append of an evolution type. The cast is the point — since rc.42 this
      // is not even expressible through the typed session append, and the
      // storage writer accepts it (the refusal is the READ path's).
      await handle.append([{
        type: 'evolution/plan-applied',
        seq: 1,
        time: Date.now(),
        data: { planId: 'legacy', memoryApplied: 1, skillApplied: 0, rejectedOps: 0 },
      } as never])
      await handle.close()

      await fiber.dispose()

      const ctx2 = new Context()
      await mountAgentLoopTestDependencies(ctx2)
      const fiber2 = await ctx2.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      try {
        // The refusal lands on the read path (open and/or read) — capture either.
        const failure = await ctx2.sessionPersistence
          .open(SessionId('evo-resume-negative'), 'read')
          .then(async (reader) => {
            try {
              await reader.read()
              return undefined
            } finally {
              await reader.close()
            }
          })
          .catch((error: unknown) => error)
        // The upstream gate is real: the poisoned log is refused wholesale.
        expect(failure).toBeInstanceOf(SessionFormatUnsupportedError)
      } finally {
        await fiber2.dispose()
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
