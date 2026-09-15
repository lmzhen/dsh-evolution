/**
 * S2-10 (FLOW1-6): the write-leg deadline does not stop the abandoned leg.
 *
 * `withTimeout(executePlan(...))` rejects at the deadline and the pipeline fails
 * loud — but the plan keeps executing, so an op can land AFTER the model was told
 * the review failed. That is the most misleading state for later decisions ("the
 * model believes nothing landed while it actually did"), so every landing is
 * recorded and a late one is reported to the model as it happens.
 */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Review from '../src/index.ts'

it('S2-10 (FLOW1-6): an op that lands after the deadline is reported to the model', { timeout: 30_000 }, async () => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const delivered: string[] = []
  const applied: unknown[] = []
  const session = {
    id: SessionId('s2-10-late-landing'),
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: () => [{ type: 'tool/call', data: { turn: 1, step: 2, callId: 'c1', name: 'skill', arguments: '{}' } }],
    deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
  } as unknown as Session
  const collect = (message: unknown): void => {
    const box = message as { content?: Array<{ type: string; text: string }> } | null
    delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
  }
  const agent = { id: session.id, session, inject: collect } as unknown as Agent
  ;(agent as { followup: unknown }).followup = collect
  ctx.agents.register(agent)
  ctx.provide('subagents', {
    start: async () => ({
      result: Promise.resolve({
        structured: {
          memoryOps: [{ target: 'memory', action: 'add', facts: 'late-landing-fact', evidence: [{ event_seq: 0 }] }],
          skillOps: [],
          summary: 'remember one fact',
        },
        stopReason: 'completed',
      }),
      dispose: async () => {},
    }),
  })
  // The write itself lands well after the 10ms deadline: the abandoned leg keeps
  // running and its `onLanded` fires when the model has already been told the
  // review failed.
  ctx.provide('memory', {
    applyBatch: async () => {
      await new Promise(resolve => setTimeout(resolve, 200))
      return { ok: true, message: 'ok' }
    },
  })
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: 'subagent' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: 1, reviewSkillInterval: 1, maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  ctx.on('evolution/plan-applied', (payload: unknown) => { applied.push(payload) })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'subagent', reviewTimeoutMs: 10 })
  ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as never)
  // The late landing is reported as its own notice — the deadline snapshot in
  // the plan-applied record cannot contain it.
  await vi.waitFor(() => {
    expect(delivered.some(text => text.includes('Memory updated') && text.includes('AFTER the review timed out'))).toBe(true)
  }, { timeout: 20_000 })
  // The durable record is the DEADLINE snapshot (nothing had landed at 10ms),
  // which is exactly why the late landing needs its own notice.
  expect(applied).toHaveLength(1)
  const record = applied[0] as { memoryApplied?: number; executionError?: string }
  expect(record.memoryApplied).toBe(0)
  expect(String(record.executionError)).toContain('timed out')
})
