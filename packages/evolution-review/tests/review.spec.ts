import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Config, REVIEW_OUTPUT_SCHEMA } from '../src/index.ts'
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
    expect(value.skillReviewTrigger).toBe('cadence')
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
      // V6-26 (0.3.37): a MISSING action is normalized to 'patch' by the
      // validator — the filter must not silently exempt it either.
      { name: 'unread-noaction' },
    ]
    const dropped = Review.filterUnreadSkillOps(ops, new Set(['read-skill']))
    expect(dropped).toBe(7)
    expect(ops.map(op => op.name).filter(Boolean)).toEqual(['read-skill', 'brand-new-skill'])
  })

  it('E-19: a deferred review spawns once per completed boundary and never concurrently (0.3.18 + 0.3.39)', async () => {
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
    emitEnd(1, 'blocked')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(starts).toBe(0) // threshold reached but DEFERRED — no mid-task spawn
    emitEnd(2)
    await vi.waitFor(() => { expect(starts).toBe(1) }) // flush spawn (held)
    emitEnd(3)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(starts).toBe(1) // pending consumed; the next stash waits for its own flush
    emitEnd(4)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(starts).toBe(1) // single-flight: the held review blocks the next flush (fallback inject at end)
    releaseStart.current?.()
  })

  it('E-6: a throwing review state service surfaces as review-error, never bubbles (0.3.18)', async () => {
    const { ctx, session, emitEnd } = await mountReviewFixture({ failState: true })
    const errors: string[] = []
    ctx.on('evolution/review-error', event => errors.push(event.sessionId))
    // substantive thresholds live on the policy service, not the plugin Config.
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, {
      reviewEnabled: true,
      memoryInterval: 1,
      skillInterval: 1,
    })
    emitEnd(1)
    await vi.waitFor(() => { expect(errors).toEqual([session.id]) })
  })

  it('E-59c: a subagent with no structured plan emits review-error at the END-flush, never mid-task (0.3.19 + 0.3.39)', async () => {
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
    emitEnd(1, 'blocked')
    await new Promise(resolve => setTimeout(resolve, 50))
    // Threshold reached but DEFERRED: no review ran, no error, no inject yet.
    expect(errors).toEqual([])
    expect(injected).toHaveLength(0)
    emitEnd(2)
    // At the completed flush the subagent runs and fails to produce a plan —
    // review-error surfaces AND the fallback injects (at the end).
    // V24-15 (v24): the fallback inject now also emits `review-scheduled`
    // (channel 'inject') — the old contract left the fallback delivery
    // invisible to the event bus, so a consumer on the subagent-mode
    // deployment would have missed every fallback review.
    await vi.waitFor(() => { expect(errors).toEqual([session.id]) })
    expect(injected).toHaveLength(1)
    expect(scheduled).toEqual([session.id])
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
    emitEnd(1, 'blocked')
    emitEnd(2) // 0.3.39: the review executes at the SECOND (flush) boundary
    // The review reaches read-name collection and completes, proving
    // `arguments: 'null'` no longer throws inside collectReadSkillNames.
    await vi.waitFor(() => { expect(applied).toHaveLength(1) })
  })

  it('E-41: the review is deferred when the subagent cannot start; the eventual fallback inject emits review-scheduled (0.3.19 + 0.3.39 + V24-15)', async () => {
    const injected: unknown[] = []
    const { ctx, session, emitEnd } = await mountReviewFixture({ onInject: message => injected.push(message) })
    const scheduled: Array<{ sessionId: string; channel?: string | undefined }> = []
    ctx.on('evolution/review-scheduled', event => scheduled.push(event))
    ctx.provide('subagents', {
      start: async () => { throw new Error('subagent spawn failed') },
    })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1, 'blocked')
    await new Promise(resolve => setTimeout(resolve, 50))
    // V6-53 (0.3.39): the spawn is DEFERRED too — no immediate run, no inject,
    // no schedule signal (E-41's deferral half stands).
    expect(injected).toHaveLength(0)
    expect(scheduled).toEqual([])
    emitEnd(2)
    await new Promise(resolve => setTimeout(resolve, 50))
    // At the completed flush the spawn fails again → the fallback injects the
    // prompt (at the end). V24-15 (v24): that delivery is no longer invisible
    // — it emits with channel 'inject', same as every other delivery path.
    expect(injected).toHaveLength(1)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]).toMatchObject({ sessionId: session.id, channel: 'inject' })
  })

  it('V6-53: a deferred cadence review executes at conversation END — neither inject nor subagent runs mid-task (0.3.39)', async () => {
    const injected: string[] = []
    let starts = 0
    const { ctx, emitEnd } = await mountReviewFixture({
      onInject: (message) => {
        const box = message as { content?: Array<{ type: string; text: string }> } | null
        const text = typeof message === 'object' && box?.content?.[0] ? box.content[0].text : ''
        injected.push(text)
      },
    })
    ctx.provide('subagents', {
      start: async () => {
        starts += 1
        throw new Error('subagent spawn failed')
      },
    })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1, 'blocked')
    await new Promise(resolve => setTimeout(resolve, 50))
    // Threshold reached but fully DEFERRED: no inject AND no subagent spawn.
    expect(injected).toHaveLength(0)
    expect(starts).toBe(0)
    emitEnd(2)
    await vi.waitFor(() => {
      expect(injected.some(text => text.includes('Auto-review'))).toBe(true)
    })
    expect(starts).toBe(1) // the subagent ran at the flush (and fell back to inject)
    expect(injected).toHaveLength(1)
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
    emitEnd(1, 'blocked')
    emitEnd(2) // 0.3.39: the review executes at the SECOND (flush) boundary
    // The plan applied (executePlan landed the memory op), so plan-applied is
    // recorded even though the result-notice inject threw.
    await vi.waitFor(() => { expect(applied).toHaveLength(1) })
    // The inject failure is NOT a review failure: no fallback review prompt was
    // injected (single inject call = the result-notice attempt) and no
    // review-error surfaced — the double-review window is closed.
    expect(onInjectCalls).toHaveLength(1)
    expect(errors).toEqual([])
  })

  it('V27 G4.3: a write leg that TIMES OUT still records the ops that landed', async () => {
    const applied: Array<{ memoryApplied: number; skillApplied: number; executionError?: string; executionFailures?: number }> = []
    const { ctx, emitEnd } = await mountReviewFixture({ onInject: () => {} })
    ctx.on('evolution/plan-applied', event => applied.push(event as never))
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({
          structured: {
            // TWO ops: the first lands, the second never returns — the deadline
            // hits mid-write.
            memoryOps: [
              { target: 'memory', action: 'add', facts: 'landed-fact', evidence: [{ event_seq: 0 }] },
              { target: 'memory', action: 'add', facts: 'never-lands', evidence: [{ event_seq: 0 }] },
            ],
            skillOps: [],
            summary: 'one lands, one hangs',
          },
        }),
        dispose: async () => {},
      }),
    })
    let calls = 0
    ctx.provide('memory', {
      applyBatch: async () => {
        calls += 1
        if (calls === 1) return { ok: true, message: 'ok' }
        return await new Promise<never>(() => {}) // hangs → the write leg times out
      },
    })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewTimeoutMs: 30 })
    emitEnd(1, 'blocked')
    emitEnd(2)
    // The payload must arrive even though the execution promise never settled:
    // before this fix the timeout skipped the emit entirely, so replay/activity
    // saw a review that changed nothing while memory had already been written.
    await vi.waitFor(() => { expect(applied).toHaveLength(1) }, { timeout: 3000 })
    expect(applied[0]?.memoryApplied).toBe(1)
    expect(applied[0]?.skillApplied).toBe(0)
    expect(applied[0]?.executionError ?? '').toContain('timed out')
  }, 15_000)

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
    emitEnd(1, 'blocked')
    emitEnd(2) // 0.3.39: the review executes at the SECOND (flush) boundary
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
    emitEnd(1, 'blocked')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(starts).toBe(0) // deferred — no mid-task spawn
    emitEnd(2)
    await vi.waitFor(() => { expect(starts).toBe(1) }) // flush: first run aborts
    await vi.waitFor(() => { expect(disposed).toBe(1) })
    // 0.3.41 (V7-02): the failed spawn fell back to a WAKING delivery — the
    // woken turn is cadence-suppressed once, so this (artificially sent)
    // turn does not spawn either. The single-flight guard HAS reset; the
    // next REAL turn below spawns again.
    emitEnd(3)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(starts).toBe(1)
    emitEnd(4)
    await vi.waitFor(() => { expect(starts).toBe(2) }) // next flush: second run succeeds
    expect(disposed).toBe(2)
  })
})

/** Shared mounting: one fake session/agent registered, one turn/end emitter. */
async function mountReviewFixture(options: {
  failState?: boolean
  onInject?: (message: unknown) => void
  onFollowup?: (message: unknown) => void
  skillArguments?: string
  noState?: boolean
  stateful?: boolean
  noFollowup?: boolean
  failSaveFrom?: number
  events?: Array<Record<string, unknown>>
} = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const stateBox: { current: unknown } = { current: null }
  if (!options.noState) {
    let saveCalls = 0
    ctx.provide('evolutionState', {
      loadReviewState: async () => {
        if (options.failState) throw new Error('state store boom')
        return options.stateful ? stateBox.current : null
      },
      saveReviewState: async (_id: string, record: unknown) => {
        saveCalls += 1
        if (options.failSaveFrom !== undefined && saveCalls >= options.failSaveFrom) {
          throw new Error('state store boom')
        }
        stateBox.current = record
      },
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
  if (!options.noFollowup) {
    ;(agent as { followup: unknown }).followup = (message: unknown) => {
      if (options.onFollowup) options.onFollowup(message)
      else options.onInject?.(message)
    }
  }
  ctx.agents.register(agent)
  const releaseStart: { current: (() => void) | undefined } = { current: undefined }
  const emitEnd = (turn: number, reasonKind: 'completed' | 'blocked' = 'completed'): void => {
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: reasonKind } } } as never)
  }
  return { ctx, session, emitEnd, releaseStart, stateBox }
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
  // substantive thresholds live on the policy service, not the plugin Config.
  ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 1,
    skillInterval: 1,
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
  emitEnd(2) // 0.3.39: the review executes at the SECOND (flush) boundary
  // The plan lands ZERO ops (the only skill op is not read this session) but
  // the model must still hear that nothing happened and why.
  await vi.waitFor(() => {
    expect(injected.some(text => text.includes('0 ops landed') && text.includes('1 op(s) skipped'))).toBe(true)
  })
})

it('0.3.40: cadence counters zero at the INJECTION and repeated threshold fires inject once per segment', async () => {
  const injected: string[] = []
  const { ctx, emitEnd, stateBox } = await mountReviewFixture({
    stateful: true,
    onInject: (message) => {
      const box = message as { content?: Array<{ type: string; text: string }> } | null
      injected.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
    },
  })
  ctx.provide('evolutionPolicy', {
    get: () => ({ ...reviewPolicy(), reviewMemoryInterval: 2, reviewSkillInterval: 2, reviewMode: 'inject' }),
  })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 2,
    skillInterval: 2,
    reviewMode: 'inject',
  })
  const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 20)) }
  // turn1 completed: count 1 < 2 → no fire, no inject.
  emitEnd(1); await settle()
  expect(injected).toHaveLength(0)
  // turn2/turn3 NOT completed (mid-task threshold fires): the kind is latched
  // once — repeated fires do not inject mid-task and do not stack.
  emitEnd(2, 'blocked'); await settle()
  emitEnd(3, 'blocked'); await settle()
  expect(injected).toHaveLength(0)
  // turn4 completed (the flush boundary): EXACTLY ONE injection, and the
  // counters are zeroed at the injection.
  emitEnd(4); await settle()
  expect(injected).toHaveLength(1)
  const saved = (stateBox.current as { turnsSinceMemory: number; turnsSinceSkill: number })
  expect(saved.turnsSinceMemory).toBe(0)
  expect(saved.turnsSinceSkill).toBe(0)
  // turn5 completed: without the zero-at-injection the counter would still be
  // ≥2 and would fire again — the fresh segment must stay silent.
  emitEnd(5); await settle()
  expect(injected).toHaveLength(1)
  // turn6 completed: the fresh segment reaches the threshold again → a NEW
  // injection (the completing-turn fire is caught by the flush `?? kind`).
  emitEnd(6); await settle()
  expect(injected).toHaveLength(2)
  // turn7: after the second zero the new segment is silent again.
  emitEnd(7); await settle()
  expect(injected).toHaveLength(2)
})

it('0.3.45: the review output schema stays inside the raw JSON-Schema type whitelist (V8-01)', () => {
  // Upstream facts (dsh-tools json-schema.ts:87 SCHEMA_TYPES + the
  // assertObjectJsonSchema injection at subagent src:434): a defineTool DSL
  // value like 'json' violates the raw-schema subset and rejects EVERY spawn,
  // silently degrading the default subagent review to the inject fallback —
  // the historical P1 that mock-based tests could never see. The review
  // array nodes deliberately omit `items` (absent accepts any JSON item).
  const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
  expect(SCHEMA_TYPES.has('json')).toBe(false) // the DSL value that caused the P1 is NOT legal here
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const type = (node as { type?: unknown }).type
    if (type !== undefined) expect(SCHEMA_TYPES.has(type as string)).toBe(true)
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null) visit(value)
    }
  }
  visit(REVIEW_OUTPUT_SCHEMA)
})

it('0.3.41: interval=1 waking delivery cannot self-drive — the injected wake turn fires once suppressed (V7-02)', async () => {
  const deliveries: string[] = []
  const { ctx, emitEnd } = await mountReviewFixture({
    stateful: true,
    onInject: (message) => {
      const box = message as { content?: Array<{ type: string; text: string }> } | null
      deliveries.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
    },
  })
  ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 1,
    skillInterval: 1,
    reviewMode: 'inject',
  })
  const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 20)) }
  // turn1 (real turn): threshold fires (first ever) → exactly one delivery,
  // and the followup marks the woken turn for one-shot fire suppression.
  emitEnd(1); await settle()
  expect(deliveries).toHaveLength(1)
  // turn2 (the woken turn): without V7-02 its own cadence would fire again
  // (interval=1, its review prompt alone is substantive) and deliver a second
  // copy — an unbounded review loop. The suppression must keep it at one.
  emitEnd(2); await settle()
  expect(deliveries).toHaveLength(1)
  // turn3 (the next REAL turn): a new threshold crossing delivers again — the
  // suppression is one-shot, normal cadence activity is not starved.
  emitEnd(3); await settle()
  expect(deliveries).toHaveLength(2)
})

it('0.3.48: a completing-turn cross of the second threshold delivers the combined review, not the stale latch (V8-04)', async () => {
  const delivered: string[] = []
  const { ctx, emitEnd } = await mountReviewFixture({
    stateful: true,
    onInject: (message) => {
      const box = message as { content?: Array<{ type: string; text: string }> } | null
      delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
    },
  })
  ctx.provide('evolutionPolicy', {
    get: () => ({ ...reviewPolicy(), reviewMemoryInterval: 5, reviewSkillInterval: 10, reviewMode: 'inject' }),
  })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 5,
    skillInterval: 10,
    reviewMode: 'inject',
  })
  const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 20)) }
  // turns 1-9 non-completing: memory crosses alone at turn 5 (latch='memory');
  // the monotonic counters keep it due through 6-9 (latch unchanged).
  for (let turn = 1; turn <= 9; turn += 1) { emitEnd(turn, 'blocked'); await settle() }
  // turn10 (completing): skill crosses at the SAME boundary → kind='combined';
  // latch-first delivery used to discard the fresh combined and deliver the
  // stale single-kind prompt (V7-14's completing-turn-cross residual window).
  emitEnd(10); await settle()
  expect(delivered).toHaveLength(1)
  expect(delivered[0]).toContain('[Auto-review]')
  expect(delivered[0]).not.toContain('— Memory')
})

it('0.3.48: a throwing review-scheduled listener cannot skip the counter reset (V8-03)', async () => {
  const delivered: string[] = []
  const { ctx, emitEnd, stateBox } = await mountReviewFixture({
    stateful: true,
    onFollowup: (message) => {
      const box = message as { content?: Array<{ type: string; text: string }> } | null
      delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
    },
  })
  ctx.on('evolution/review-scheduled', () => { throw new Error('listener boom') })
  const warnSpy = vi.spyOn(ctx.logger, 'warn')
  ctx.provide('subagents', {
    start: async () => ({
      result: Promise.resolve({
        structured: { memoryOps: [{ target: 'memory', action: 'add', facts: 'f', evidence: [{ event_seq: 0 }] }], skillOps: [], summary: 'ok' },
      }),
      dispose: async () => {},
    }),
  })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
  emitEnd(1, 'blocked')
  emitEnd(2) // flush: subagent succeeds → schedule emit throws → protection domain
  await vi.waitFor(() => { expect(delivered).toHaveLength(1) }) // the result notice still lands
  const saved = stateBox.current as { turnsSinceMemory: number; turnsSinceSkill: number }
  expect(saved.turnsSinceMemory).toBe(0) // reset NOT skipped by the throwing listener
  expect(saved.turnsSinceSkill).toBe(0)
  expect(warnSpy.mock.calls.some(([message]) => String(message).includes('review-scheduled emit failed'))).toBe(true)
})

it('0.3.42: subagent-success result notice wakes via followup, not inject (V7-03)', async () => {
  const followups: unknown[] = []
  const injects: unknown[] = []
  const { ctx, emitEnd } = await mountReviewFixture({
    onFollowup: (message) => { followups.push(message) },
    onInject: (message) => { injects.push(message) },
  })
  ctx.provide('subagents', {
    start: async () => ({
      result: Promise.resolve({
        structured: { memoryOps: [{ target: 'memory', action: 'add', facts: 'f1', evidence: [{ event_seq: 0 }] }], skillOps: [], summary: 'ok' },
      }),
      dispose: async () => {},
    }),
  })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
  emitEnd(1, 'blocked') // latch mid-task
  emitEnd(2) // flush: subagent succeeds → the result notice must WALK the parent
  await vi.waitFor(() => { expect(followups).toHaveLength(1) })
  expect(injects).toHaveLength(0)
})

it('0.3.42: a failed counter-reset persist warns once instead of repeating silently (V7-04)', async () => {
  const delivered: unknown[] = []
  const { ctx, emitEnd } = await mountReviewFixture({
    stateful: true,
    failSaveFrom: 2, // save #1 (pre-flush) succeeds; save #2 (post-delivery reset) fails
    onFollowup: (message) => { delivered.push(message) },
  })
  const warnSpy = vi.spyOn(ctx.logger, 'warn')
  ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 1,
    skillInterval: 1,
    reviewMode: 'inject',
  })
  emitEnd(1)
  await vi.waitFor(() => { expect(delivered).toHaveLength(1) }) // delivery itself succeeded
  await vi.waitFor(() => {
    expect(warnSpy.mock.calls.some(([message]) => String(message).includes('could not be persisted after a delivered review'))).toBe(true)
  })
})

it('0.3.40: without a followup the waking delivery degrades to inject', async () => {
  const injected: string[] = []
  const { ctx, emitEnd } = await mountReviewFixture({ noFollowup: true, onInject: () => { injected.push('x') } })
  ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 1,
    skillInterval: 1,
    reviewMode: 'inject',
  })
  emitEnd(1)
  await vi.waitFor(() => { expect(injected).toHaveLength(1) })
})

it('0.3.40: the default delivery wakes via agent.followup, not inject', async () => {
  const followups: unknown[] = []
  const injects: unknown[] = []
  const { ctx, emitEnd } = await mountReviewFixture({
    onFollowup: (message) => { followups.push(message) },
    onInject: (message) => { injects.push(message) },
  })
  ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 1,
    skillInterval: 1,
    reviewMode: 'inject',
  })
  emitEnd(1)
  await vi.waitFor(() => { expect(followups).toHaveLength(1) })
  expect(injects).toHaveLength(0)
})

it('P2-12 (v12): the completion channel delivers through the waking followup channel (reviewWakeInject)', async () => {
  const toolCalls = Array.from({ length: 25 }, (_, i) => ({
    type: 'tool/call' as const,
    data: { turn: 1, step: i + 2, callId: `c${i}`, name: 'skill', arguments: '{}' },
  }))
  const followups: unknown[] = []
  const injects: unknown[] = []
  const { ctx, emitEnd } = await mountReviewFixture({
    onFollowup: (message) => { followups.push(message) },
    onInject: (message) => { injects.push(message) },
    events: toolCalls,
  })
  ctx.provide('evolutionPolicy', { get: () => ({ ...reviewPolicy(), reviewMemoryInterval: 1_000_000, reviewSkillInterval: 1_000_000 }) })
  await ctx.plugin(Review, {
    reviewEnabled: true,
    reviewMode: 'subagent',
    memoryInterval: 1_000_000,
    skillInterval: 1_000_000,
    skillReviewTrigger: 'completion',
    skillReviewCompletionMinToolCalls: 20,
  })
  // The completion channel used to inject directly (never waking, reviewWakeInject
  // ignored, no woken-turn cadence suppression); it must share deliverMessage.
  emitEnd(1)
  await vi.waitFor(() => { expect(followups).toHaveLength(1) })
  expect(injects).toHaveLength(0)
})

// V26-07 (v25): two-session mounting for the deferred-completion queue — the
// in-flight review (Y) and the deferred completion (X) must be DIFFERENT
// sessions for the drain's attribution/rollback to be observable.
async function mountTwoSessions() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  // V26-07 fix-up: persist per-session review counters for the duration of the
  // fixture — the always-null loader reset them every turn, so Y's skill
  // counter never reached the interval-2 cadence threshold and the fixture
  // silently exercised only the completion channel (no subagent, no deferral).
  const reviewStates = new Map<string, { turnsSinceMemory: number; turnsSinceSkill: number; lastTurn: number }>()
  ctx.provide('evolutionState', {
    loadReviewState: async (id: string) => reviewStates.get(id) ?? null,
    saveReviewState: async (
      id: string,
      record: { turnsSinceMemory: number; turnsSinceSkill: number; lastTurn: number },
    ) => { reviewStates.set(id, { ...record }) },
  })
  // V25-03 uses a second completed turn to prove the completion flag re-arms.
  // Clear that session's cadence counters first so the re-arm turn cannot trip
  // the interval-2 cadence instead (which would deliver via the fallback path
  // and make the rollback assertion pass for the wrong reason).
  const resetReviewState = (id: string): void => { reviewStates.delete(id) }
  // skillInterval=2: session Y fires its cadence flush on the 2nd substantive
  // turn; session X's single substantive turn stays under the cadence
  // threshold and reaches the completion channel (cumulative 1 ≥ min 1).
  ctx.provide('evolutionPolicy', { get: () => ({ ...reviewPolicy(), reviewSkillInterval: 2, reviewMemoryInterval: 999 }) })
  const scheduled: Array<{ sessionId: string; channel?: string | undefined }> = []
  ctx.on('evolution/review-scheduled', e => scheduled.push(e))

  const mk = (id: string) => {
    const injected: string[] = []
    let failFollowup = false
    const session = {
      id: SessionId(id),
      seq: 1,
      header: { origin: undefined },
      events: [{ type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{}' } }],
      deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
    } as unknown as Session
    const agent = {
      id: session.id,
      session,
      inject: (_message: unknown) => { if (failFollowup) throw new Error('followup boom'); injected.push(id) },
      followup: (_message: unknown) => { if (failFollowup) throw new Error('followup boom'); injected.push(id) },
    } as unknown as Agent
    ctx.agents.register(agent)
    const emitEnd = (turn: number, reasonKind: 'completed' | 'blocked' = 'completed'): void => {
      ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: reasonKind } } } as never)
    }
    return { id, injected, emitEnd, setFail: (value: boolean) => { failFollowup = value } }
  }
  const y = mk('y-cadence')
  const x = mk('x-completion')

  let releaseY!: (value: { text: string; structured: null }) => void
  const yResult = new Promise<{ text: string; structured: null }>((resolve) => { releaseY = resolve })
  ctx.provide('subagents', {
    start: async () => ({ result: yResult, dispose: async () => {} }),
  })

  await ctx.plugin(Review, {
    reviewEnabled: true,
    memoryInterval: 999,
    skillInterval: 2,
    skillReviewTrigger: 'both',
    skillReviewCompletionMinToolCalls: 1,
  })
  return { ctx, y, x, releaseY, scheduled, resetReviewState }
}

it('V25-02: a deferred completion review is emitted under its OWN session id, not the id of the in-flight review', async () => {
  const { y, x, releaseY, scheduled } = await mountTwoSessions()
  // Y: cadence fires at the 2nd substantive turn → the subagent start hangs
  // (reviewInFlight). X: the completed turn reaches the completion channel,
  // which defers under X's identity while Y is in flight.
  y.emitEnd(1, 'blocked')
  await new Promise(resolve => setTimeout(resolve, 20))
  y.emitEnd(2)
  await new Promise(resolve => setTimeout(resolve, 20))
  x.emitEnd(1)
  await new Promise(resolve => setTimeout(resolve, 20))
  // Release Y: the flush fails (structured null) → Y's finally drains the
  // queue → X's completion prompt is delivered to X's agent and the event
  // must carry X's session id (the pre-fix code emitted Y's id here).
  releaseY({ text: 'x', structured: null })
  await vi.waitFor(() => {
    expect(scheduled.some(e => e.sessionId === 'x-completion' && e.channel === 'completion')).toBe(true)
  })
  expect(x.injected).toContain('x-completion')
})

it('V25-03: a FAILED deferred completion delivery rolls completionInjected back so the review re-arms', async () => {
  const { y, x, releaseY, resetReviewState } = await mountTwoSessions()
  y.emitEnd(1, 'blocked')
  await new Promise(resolve => setTimeout(resolve, 20))
  y.emitEnd(2)
  await new Promise(resolve => setTimeout(resolve, 20))
  // X defers; the drain's delivery to X will THROW (V4-21 shape).
  x.setFail(true)
  x.emitEnd(1)
  await new Promise(resolve => setTimeout(resolve, 20))
  releaseY({ text: 'x', structured: null })
  await new Promise(resolve => setTimeout(resolve, 30))
  // The delivery failed — without the rollback the flag stays set and this
  // session's one completion review is permanently lost in-process.
  x.setFail(false)
  resetReviewState('x-completion')
  x.emitEnd(2)
  await new Promise(resolve => setTimeout(resolve, 30))
  // The re-armed completion review actually delivers on the next turn.
  expect(x.injected).toContain('x-completion')
})
