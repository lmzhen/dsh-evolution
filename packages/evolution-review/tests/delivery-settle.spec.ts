/**
 * S2-7 (FLOW1-2 / FLOW1-4): the cadence/inject delivery must settle where the
 * delivery is CONFIRMED, not where the trigger is enqueued.
 * - Case 1 (FLOW1-4): while a review is in flight, several boundaries may latch
 *   the same segment; the queue kept every entry, so the drain delivered TWO
 *   prompts for one segment. Entries now coalesce per (session, kind).
 * - Case 2 (FLOW1-2): a queued entry had already consumed its latch and zeroed
 *   its counters at the enqueue boundary, so a FAILED drain delivery was zero
 *   reviews for that segment with no trace. A failed inject-channel delivery now
 *   re-arms that session's cadence latch; the completion channel's flag rollback
 *   (V25-03) stays as it was.
 * Both cases bound the in-flight window with the S2-6 watchdog (a handle that
 * never settles), so the drain runs deterministically ~50ms after the start.
 */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Review from '../src/index.ts'

interface Fixture {
  ctx: Context
  delivered: string[]
  errors: unknown[]
  starts: () => number
  emitEnd: (label: string, turn: number) => void
  policy: { memoryInterval: number; skillInterval: number }
  control: { throwInject: boolean }
}

async function mount(labels: string[]): Promise<Fixture> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const delivered: string[] = []
  const errors: unknown[] = []
  const control = { throwInject: false }
  const policy = { memoryInterval: 1, skillInterval: 1 }
  const turns = new Map<string, number>()
  const emitEnd = (label: string, turn: number): void => {
    turns.set(label, turn)
    const session = sessions.get(label) as Session
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  const sessions = new Map<string, Session>()
  for (const label of labels) {
    const id = SessionId(label)
    const session = {
      id,
      seq: 1,
      header: { origin: undefined },
      snapshotEvents: () => [{
        type: 'tool/call',
        data: { turn: turns.get(label) ?? 0, step: 2, callId: label + '-' + String(turns.get(label) ?? 0), name: 'skill', arguments: '{}' },
      }],
      deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
    } as unknown as Session
    sessions.set(label, session)
    // No `followup`: delivery then goes through agent.inject, whose throw is
    // what a refused delivery looks like to the caller (warn + return false).
    const agent = {
      id,
      session,
      inject: (message: unknown) => {
        if (control.throwInject) throw new Error('inject refused (fixture)')
        const box = message as { content?: Array<{ type: string; text: string }> } | null
        delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
      },
    } as unknown as Agent
    ctx.agents.register(agent)
  }
  let starts = 0
  const hangingRun = { result: new Promise(() => {}), dispose: async () => {} }
  ctx.provide('subagents', { start: async () => { starts += 1; return hangingRun } })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: 'subagent' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: policy.memoryInterval, reviewSkillInterval: policy.skillInterval,
      maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
  ctx.on('evolution/review-error', (payload: unknown) => { errors.push(payload) })
  ctx.on('evolution/review-scheduled', () => {})
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'subagent', reviewTimeoutMs: 50 })
  return { ctx, delivered, errors, starts: () => starts, emitEnd, policy, control }
}

it('S2-7 (FLOW1-4): two triggers during one in-flight window deliver exactly ONE prompt', { timeout: 30_000 }, async () => {
  const fixture = await mount(['s2-7-coalesce'])
  fixture.emitEnd('s2-7-coalesce', 1)
  fixture.emitEnd('s2-7-coalesce', 2)
  fixture.emitEnd('s2-7-coalesce', 3)
  // The pipeline is asynchronous: boundary 1's start lands a few microtasks
  // later, and the per-session lock keeps boundaries 2/3 behind it.
  await vi.waitFor(() => { expect(fixture.starts()).toBe(1) }, { timeout: 15_000 })
  // The watchdog abandons the hanging handle; the flush then falls back to the
  // prompt for boundary 1, and the drain delivers the coalesced entry once.
  await vi.waitFor(() => { expect(fixture.errors).toHaveLength(1) }, { timeout: 15_000 })
  await vi.waitFor(() => { expect(fixture.delivered).toHaveLength(2) }, { timeout: 15_000 })
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(fixture.delivered).toHaveLength(2)
})

it('S2-7 (FLOW1-2): a failed drain delivery restores that session\u2019s latch instead of losing the review', { timeout: 30_000 }, async () => {
  const fixture = await mount(['s2-7-owner', 's2-7-waiter'])
  fixture.emitEnd('s2-7-owner', 1)
  fixture.emitEnd('s2-7-waiter', 1)
  await vi.waitFor(() => { expect(fixture.starts()).toBe(1) }, { timeout: 15_000 })
  // Both the owner's fallback and the waiters drain delivery are refused.
  fixture.control.throwInject = true
  await vi.waitFor(() => { expect(fixture.errors).toHaveLength(1) }, { timeout: 15_000 })
  // Cadence can no longer fire on its own: only a restored latch can deliver.
  fixture.policy.memoryInterval = 1_000_000
  fixture.policy.skillInterval = 1_000_000
  fixture.control.throwInject = false
  fixture.emitEnd('s2-7-waiter', 2)
  await vi.waitFor(() => { expect(fixture.delivered.length).toBeGreaterThan(0) }, { timeout: 15_000 })
})
