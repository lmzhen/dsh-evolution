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
  it('defaults review subagent tools to the Anchored Standard discovery pair', () => {
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
})

/** Shared mounting: one fake session/agent registered, one turn/end emitter. */
async function mountReviewFixture(options: {
  failState?: boolean
  onInject?: (message: unknown) => void
  skillArguments?: string
  noState?: boolean
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
