/**
 * S2-6 (FLOW1-1): the platform's abort is not guaranteed to settle the subagent
 * run handle. `run.result` / `run.dispose` were awaited without a bound, so a
 * handle that never settles after its own AbortSignal left `reviewInFlight` set
 * for the process lifetime — every later turn deferred instead of reviewing, the
 * deferred queue never drained, and nothing was logged or emitted. This spec
 * drives exactly that handle and observes the three promises of the fix through
 * public behavior only: the flag resets (a later boundary starts a NEW run), the
 * deferred entry is delivered (not silently dropped), and review-error is
 * emitted for the abandoned handle.
 */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Review from '../src/index.ts'

it('S2-6 (FLOW1-1): a handle that never settles is abandoned — flag reset, queue drained, review-error emitted', { timeout: 30_000 }, async () => {
  const delivered: string[] = []
  const collect = (message: unknown): void => {
    const box = message as { content?: Array<{ type: string; text: string }> } | null
    delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
  }
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  // Each emitted turn must present NEW events: the cadence fold reads the
  // session snapshot, so a static array would count once and never fire again.
  let currentTurn = 0
  const session = {
    id: SessionId('s2-6-settle-fixture'),
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: () => [{
      type: 'tool/call',
      data: { turn: currentTurn, step: 2, callId: 'c' + String(currentTurn), name: 'skill', arguments: '{}' },
    }],
    deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
  } as unknown as Session
  const agent = { id: session.id, session, inject: collect } as unknown as Agent
  ;(agent as { followup: unknown }).followup = collect
  ctx.agents.register(agent)
  const emitEnd = (turn: number): void => {
    currentTurn = turn
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }

  let starts = 0
  const hangingRun = { result: new Promise(() => {}), dispose: async () => {} }
  ctx.provide('subagents', { start: async () => { starts += 1; return hangingRun } })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: 'subagent' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: 1, reviewSkillInterval: 1, maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
  const errors: unknown[] = []
  ctx.on('evolution/review-error', (payload: unknown) => { errors.push(payload) })
  // 50ms review timeout => the watchdog budget is min(50, 5s) = 50ms.
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'subagent', reviewTimeoutMs: 50 })

  emitEnd(1)
  emitEnd(2)
  // The second boundary arrived while the first run was in flight: it must be
  // queued, never a second concurrent run, and nothing may be delivered yet.
  await vi.waitFor(() => { expect(starts).toBe(1) })
  expect(delivered).toHaveLength(0)

  await vi.waitFor(() => { expect(errors).toHaveLength(1) }, { timeout: 15_000 })
  await vi.waitFor(() => { expect(delivered.length).toBeGreaterThan(0) }, { timeout: 15_000 })
  // Several further boundaries: the drain's delivery arms the one-shot wake
  // suppression (V7-02), so the NEXT completed turn is consumed by it. The
  // assertion is about the flag being reset at all — a stuck flag never starts
  // a second run no matter how many boundaries arrive.
  for (const turn of [3, 4, 5]) emitEnd(turn)
  await vi.waitFor(() => { expect(starts).toBe(2) }, { timeout: 15_000 })
  // The third boundary is separate from the drain's delivery on purpose: the
  // drain may arm the one-shot wake suppression (V7-02), and the assertion is
  // about the FLAG, not about which particular boundary fires next.
})
