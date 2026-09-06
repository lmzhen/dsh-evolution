import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Config } from '../src/index.ts'
import * as Review from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type {} from '@deepseek-ai/dsh-evolution-core'

describe('evolution-review', () => {
  it('defaults review subagent tools to the plain skill tool only (E-59e: no discovery pair on this platform)', () => {
    const value = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: { reviewToolAllow: string[] } } } })['~standard'].validate({}).value
    expect(value.reviewToolAllow).toEqual(['skill'])
  })

  it('loads with review disabled', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Review, { reviewEnabled: false })
    expect(ctx.get('agents')).toBeDefined()
  })

  it('defaults the completion channel to both with a long-conversation threshold', () => {
    const value = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: { skillReviewTrigger: string; skillReviewCompletionMinToolCalls: number } } } })['~standard'].validate({}).value
    expect(value.skillReviewTrigger).toBe('both')
    expect(value.skillReviewCompletionMinToolCalls).toBe(20)
  })

  it('completion fires once for a completed turn on a proven-long session', () => {
    expect(Review.shouldCompletionReview({ kind: 'completed' }, 20, 20)).toBe(true)
    // Interrupted/error turns are not task completion.
    expect(Review.shouldCompletionReview({ kind: 'interrupted' }, 20, 20)).toBe(false)
    expect(Review.shouldCompletionReview({ kind: 'error' }, 20, 20)).toBe(false)
    // The long-conversation gate protects short sessions.
    expect(Review.shouldCompletionReview({ kind: 'completed' }, 19, 20)).toBe(false)
    expect(Review.shouldCompletionReview(undefined, 99, 20)).toBe(false)
  })

  it('read-mark keeps unread mutating targets out of the background review', () => {
    const ops = [
      { action: 'patch', name: 'unread-skill' },
      { action: 'patch', name: 'read-skill' },
      { action: 'update', name: 'unread-skill' },
      { action: 'write_file', name: 'unread-skill' },
      { action: 'remove_file', name: 'unread-skill' },
      { action: 'edit', name: 'unread-skill' },
      { action: 'restructure', name: 'unread-skill' },
      { action: 'create', name: 'brand-new-skill' },
      { action: 'patch' },
    ]
    const dropped = Review.filterUnreadSkillOps(ops, new Set(['read-skill']))
    expect(dropped).toBe(6)
    expect(ops.map(op => op.name).filter(Boolean)).toEqual(['read-skill', 'brand-new-skill'])
  })

  it('E-19: concurrent turn/end changes spawn only one review subagent (0.3.18)', async () => {
    const { ctx, emitEnd, releaseStart } = await mountReviewFixture()
    let starts = 0
    ctx.provide('subagents', {
      start: async () => {
        starts += 1
        await new Promise<void>((resolve) => { releaseStart.current = resolve })
        return { result: Promise.resolve({ structured: { memoryOps: [], skillOps: [], summary: 'no-op' } }), dispose: async () => {} }
      },
    })
    // substantive thresholds live on the policy service, not the plugin Config.
    ctx.provide('evolutionPolicy', {
      get: () => ({
        reviewMode: 'subagent',
        substantiveMinToolCalls: 1,
        substantiveMinUserChars: 0,
        substantiveMinAgentChars: 0,
        reviewMemoryInterval: 1,
        reviewSkillInterval: 1,
        maxOpsPerPlan: 5,
        protectedSkillNames: [],
        memoryChars: 10_000,
        userChars: 10_000,
        skillContentChars: 10_000,
        memoryReviewModel: 'model-x',
        skillReviewModel: 'model-x',
      }),
    })
    await ctx.plugin(Review, {
      reviewEnabled: true,
      memoryInterval: 1,
      skillInterval: 1,
      reviewMode: 'subagent',
    })
    emitEnd(1)
    await vi.waitFor(() => { expect(starts).toBe(1) })
    // Second turn/end while the first review is still running: the signal
    // advances but no second subagent spawns (single-flight).
    emitEnd(2)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(starts).toBe(1)
    releaseStart.current?.()
  })

  it('E-6: a throwing review state service surfaces as review-error, never bubbles (0.3.18)', async () => {
    const { ctx, session, emitEnd } = await mountReviewFixture({ failState: true })
    const errors: string[] = []
    ctx.on('evolution/review-error', event => errors.push(event.sessionId))
    await ctx.plugin(Review, {
      reviewEnabled: true,
      memoryInterval: 1,
      skillInterval: 1,
      substantiveMinToolCalls: 1,
      substantiveMinUserChars: 0,
      substantiveMinAgentChars: 0,
    })
    emitEnd(1)
    await vi.waitFor(() => { expect(errors).toEqual([session.id]) })
  })

  it('E-59c: a started subagent with no structured plan emits review-error and falls back to inject (0.3.19)', async () => {
    const injected: unknown[] = []
    const { ctx, session, emitEnd } = await mountReviewFixture({ onInject: message => injected.push(message) })
    const errors: string[] = []
    const scheduled: string[] = []
    ctx.on('evolution/review-error', event => errors.push(event.sessionId))
    ctx.on('evolution/review-scheduled', event => scheduled.push(event.sessionId))
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({ structured: null }),
        dispose: async () => {},
      }),
    })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1)
    await vi.waitFor(() => { expect(errors).toEqual([session.id]) })
    // The review-error surfaced (no crash) and the caller fell through to the
    // inject fallback path — which must NOT emit a schedule signal (E-41).
    expect(scheduled).toEqual([])
    expect(injected).toHaveLength(1)
  })

  it('F-203: a skill tool/call with JSON-null arguments does not crash read-name collection', async () => {
    const { ctx, emitEnd } = await mountReviewFixture({ skillArguments: 'null' })
    const applied: string[] = []
    ctx.on('evolution/plan-applied', event => applied.push(event.sessionId))
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({ structured: { memoryOps: [], skillOps: [], summary: 'no-op' } }),
        dispose: async () => {},
      }),
    })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1)
    // The review reaches read-name collection and completes, proving
    // `arguments: 'null'` no longer throws inside collectReadSkillNames.
    await vi.waitFor(() => { expect(applied).toHaveLength(1) })
  })

  it('E-41: review-scheduled is not emitted when the subagent review does not start (0.3.19)', async () => {
    const injected: unknown[] = []
    const { ctx, emitEnd } = await mountReviewFixture({ onInject: message => injected.push(message) })
    const scheduled: string[] = []
    ctx.on('evolution/review-scheduled', event => scheduled.push(event.sessionId))
    ctx.provide('subagents', {
      start: async () => { throw new Error('subagent spawn failed') },
    })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1)
    // Wait for the inject fallback (started=false) to prove the async path
    // settled before asserting no schedule signal was emitted.
    await vi.waitFor(() => { expect(injected).toHaveLength(1) })
    expect(scheduled).toEqual([])
  })

  it('G4.5: warns once when the evolution-state service is absent (stateless cadence)', async () => {
    const { ctx, emitEnd } = await mountReviewFixture({ noState: true })
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1)
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('evolution-state service not mounted'))
    })
    warnSpy.mockRestore()
  })

  it('G4.4: a result-notice inject failure does not re-trigger a review (double-review)', async () => {
    const onInjectCalls: string[] = []
    const { ctx, emitEnd } = await mountReviewFixture({
      onInject: () => { onInjectCalls.push('inject'); throw new Error('inject boom') },
    })
    const applied: string[] = []
    const errors: string[] = []
    ctx.on('evolution/plan-applied', event => applied.push(event.sessionId))
    ctx.on('evolution/review-error', event => errors.push(event.sessionId))
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({
          structured: {
            memoryOps: [{ target: 'memory', action: 'add', facts: 'G4.4-fact', evidence: [{ event_seq: 0 }] }],
            skillOps: [],
            summary: 'apply a memory op',
          },
        }),
        dispose: async () => {},
      }),
    })
    ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1)
    // The plan applied (executePlan landed the memory op), so plan-applied is
    // recorded even though the result-notice inject threw.
    await vi.waitFor(() => { expect(applied).toHaveLength(1) })
    // The inject failure is NOT a review failure: no fallback review prompt was
    // injected (single inject call = the result-notice attempt) and no
    // review-error surfaced — the double-review window is closed.
    expect(onInjectCalls).toHaveLength(1)
    expect(errors).toEqual([])
  })

  it('F-363: the completion channel fires through runOnTurnEnd on a proven-long session', async () => {
    const toolCalls = Array.from({ length: 25 }, (_, i) => ({
      type: 'tool/call' as const,
      data: { turn: 1, step: i + 2, callId: `c${i}`, name: 'skill', arguments: '{}' },
    }))
    const injected: unknown[] = []
    const { ctx, emitEnd } = await mountReviewFixture({ onInject: message => injected.push(message), events: toolCalls })
    let scheduled = false
    ctx.on('evolution/review-scheduled', () => { scheduled = true })
    ctx.provide('evolutionPolicy', { get: () => ({ ...reviewPolicy(), reviewMemoryInterval: 1_000_000, reviewSkillInterval: 1_000_000 }) })
    await ctx.plugin(Review, {
      reviewEnabled: true,
      reviewMode: 'subagent',
      memoryInterval: 1_000_000,
      skillInterval: 1_000_000,
      skillReviewTrigger: 'completion',
      skillReviewCompletionMinToolCalls: 20,
    })
    // A proven-long session: ≥20 tool/call events on this turn (the cadence
    // counters are starved by the huge intervals, so ONLY the completion gate
    // can fire). The completion channel is an INJECT channel — the prompt is
    // sent to the parent session, not a subagent spawn.
    emitEnd(1)
    await vi.waitFor(() => {
      const texts = injected.map((message) => {
        const box = message as { content?: Array<{ type: string; text: string }> } | null
        return typeof message === 'object' && box?.content?.[0] ? box.content[0].text : ''
      })
      expect(texts.some(text => text.includes('Auto-review'))).toBe(true)
    })
    expect(scheduled).toBe(true)
  })

  it('V4-21: a mid-plan execute throw is a partial application, never a re-inject (F-334)', async () => {
    const injected: unknown[] = []
    const applied: string[] = []
    const appliedEvents: Array<{ executionFailures?: number; executionError?: string }> = []
    const { ctx, emitEnd } = await mountReviewFixture({ onInject: message => injected.push(message) })
    ctx.on('evolution/plan-applied', (event) => {
      applied.push(event.sessionId)
      // V5-19: the event carries the execution-failure dimension (abort reason).
      appliedEvents.push(event as unknown as { executionFailures?: number; executionError?: string })
    })
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({
          structured: {
            memoryOps: [
              { target: 'memory', action: 'add', facts: 'f1', evidence: [{ event_seq: 0 }] },
              { target: 'memory', action: 'add', facts: 'f2', evidence: [{ event_seq: 0 }] },
            ],
            skillOps: [],
            summary: 'two memory ops',
          },
        }),
        dispose: async () => {},
      }),
    })
    // The first op lands, the second throws an IO exception (not ok:false).
    let calls = 0
    ctx.provide('memory', {
      applyBatch: async () => {
        calls += 1
        if (calls === 2) throw new Error('io boom')
        return { ok: true, message: 'ok' }
      },
    })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1)
    // The plan DID run (partially), so plan-applied fires once.
    await vi.waitFor(() => { expect(applied).toHaveLength(1) })
    const texts = injected.map((message) => {
      const box = message as { content?: Array<{ type: string; text: string }> } | null
      return typeof message === 'object' && box?.content?.[0] ? box.content[0].text : ''
    })
    // started=true (the review happened), so the SAME kind is NOT re-injected.
    expect(texts.some(text => text.includes('Review kind:'))).toBe(false)
    // The partial failure is surfaced — the model is told what landed.
    expect(texts.some(text => text.includes('部分操作失败'))).toBe(true)
    // V5-19: the durable event names the abort so observability can tell an
    // execution failure from a validation rejection.
    expect(appliedEvents[0]?.executionError).toContain('io boom')
  })

  it('V4-21: a failing completion inject rolls the flag back so the next completion re-triggers (F-334)', async () => {
    const toolCalls = Array.from({ length: 25 }, (_, i) => ({
      type: 'tool/call' as const,
      data: { turn: 1, step: i + 2, callId: `c${i}`, name: 'skill', arguments: '{}' },
    }))
    let injectCalls = 0
    const injected: unknown[] = []
    const { ctx, emitEnd } = await mountReviewFixture({
      onInject: (message) => {
        injectCalls += 1
        if (injectCalls === 1) throw new Error('inject boom')
        injected.push(message)
      },
      events: toolCalls,
    })
    const scheduled: string[] = []
    ctx.on('evolution/review-scheduled', event => scheduled.push(event.sessionId))
    ctx.provide('evolutionPolicy', { get: () => ({ ...reviewPolicy(), reviewMemoryInterval: 1_000_000, reviewSkillInterval: 1_000_000 }) })
    await ctx.plugin(Review, {
      reviewEnabled: true,
      reviewMode: 'subagent',
      memoryInterval: 1_000_000,
      skillInterval: 1_000_000,
      skillReviewTrigger: 'completion',
      skillReviewCompletionMinToolCalls: 20,
    })
    emitEnd(1)
    // First completion: the inject throws → the flag is rolled back, and no
    // schedule signal is emitted (the review was never dispatched).
    await vi.waitFor(() => { expect(injectCalls).toBe(1) })
    expect(scheduled).toEqual([])
    emitEnd(2)
    // The flag was rolled back, so the next completion re-triggers and succeeds.
    await vi.waitFor(() => { expect(injectCalls).toBe(2) })
    expect(scheduled).toHaveLength(1)
  })

  it('F-102 (V4-27): an aborted run is disposed and the single-flight guard resets for the next turn', async () => {
    const { ctx, emitEnd } = await mountReviewFixture()
    let disposed = 0
    let starts = 0
    ctx.provide('subagents', {
      start: async () => {
        starts += 1
        // Turn 1 aborts; turn 2 succeeds — a stale in-flight guard would block
        // the second spawn (retry stacking / leak).
        if (starts === 1) return { result: Promise.reject(new Error('abort')), dispose: async () => { disposed += 1 } }
        return { result: Promise.resolve({ structured: { memoryOps: [], skillOps: [], summary: 'ok' } }), dispose: async () => { disposed += 1 } }
      },
    })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1)
    await vi.waitFor(() => { expect(starts).toBe(1) })
    await vi.waitFor(() => { expect(disposed).toBe(1) })
    emitEnd(2)
    await vi.waitFor(() => { expect(starts).toBe(2) })
    expect(disposed).toBe(2)
  })
})

/** Shared mounting: one fake session/agent registered, one turn/end emitter. */
async function mountReviewFixture(options: {
  failState?: boolean
  onInject?: (message: unknown) => void
  skillArguments?: string
  noState?: boolean
  events?: Array<Record<string, unknown>>
} = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  if (!options.noState) {
    ctx.provide('evolutionState', {
      loadReviewState: async () => {
        if (options.failState) throw new Error('state store boom')
        return null
      },
      saveReviewState: async () => {},
    })
  }
  const session = {
    id: SessionId('e19-fixture-session'),
    // seq=1 ⇒ foldTurn starts at 0 and scans the tool/call below (substantive).
    seq: 1,
    header: { origin: undefined },
    events: [
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: options.skillArguments ?? '{}' } },
      ...(options.events ?? []),
    ],
    deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
  } as unknown as Session
  const agent = { id: session.id, session, inject: (message: unknown) => { options.onInject?.(message) } } as unknown as Agent
  ctx.agents.register(agent)
  const releaseStart: { current: (() => void) | undefined } = { current: undefined }
  const emitEnd = (turn: number): void => {
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  return { ctx, session, emitEnd, releaseStart }
}

/** A policy fake whose low thresholds make the single skill tool/call substantive. */
function reviewPolicy() {
  return {
    reviewMode: 'subagent' as const,
    substantiveMinToolCalls: 1,
    substantiveMinUserChars: 0,
    substantiveMinAgentChars: 0,
    reviewMemoryInterval: 1,
    reviewSkillInterval: 1,
    maxOpsPerPlan: 5,
    protectedSkillNames: [] as string[],
    memoryChars: 10_000,
    userChars: 10_000,
    skillContentChars: 10_000,
    memoryReviewModel: 'model-x',
    skillReviewModel: 'model-x',
  }
}

it('V6-23: a throwing review-error listener does not replace the turn-end failure (0.3.36)', async () => {
  const { ctx, session, emitEnd } = await mountReviewFixture({ failState: true })
  const errors: string[] = []
  ctx.on('evolution/review-error', (event) => {
    errors.push(event.sessionId)
    // A synchronously-throwing listener (cordis emit calls listeners directly):
    // without the protection domain this escapes the catch as an unhandled
    // rejection and the original failure is masked.
    throw new Error('listener boom')
  })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 1,
    skillInterval: 1,
    substantiveMinToolCalls: 1,
    substantiveMinUserChars: 0,
    substantiveMinAgentChars: 0,
  })
  emitEnd(1)
  await vi.waitFor(() => { expect(errors).toEqual([session.id]) })
  // The thrown listener was contained: exactly one signal, no crash, and the
  // pipeline is still alive for the next turn-end.
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(errors).toEqual([session.id])
})

it('V6-24: a zero-landing plan still notifies the model with the reasons (0.3.36)', async () => {
  const injected: string[] = []
  const { ctx, emitEnd } = await mountReviewFixture({
    onInject: (message) => {
      const box = message as { content?: Array<{ type: string; text: string }> } | null
      const text = typeof message === 'object' && box?.content?.[0] ? box.content[0].text : ''
      injected.push(text)
    },
  })
  ctx.provide('subagents', {
    start: async () => ({
      result: Promise.resolve({
        structured: {
          memoryOps: [],
          skillOps: [{ action: 'patch', name: 'unread-skill', old_string: 'a', new_string: 'b', evidence: [{ event_seq: 0 }] }],
          summary: 'patch an unread skill',
        },
      }),
      dispose: async () => {},
    }),
  })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
  emitEnd(1)
  // The plan lands ZERO ops (the only skill op is not read this session) but
  // the model must still hear that nothing happened and why.
  await vi.waitFor(() => {
    expect(injected.some(text => text.includes('0 ops landed') && text.includes('1 op(s) skipped'))).toBe(true)
  })
})
