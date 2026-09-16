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
  // 50ms review timeout => result budget 50 + min(5s, 50) = 100ms, dispose
  // budget min(5s, 50) = 50ms (S1.1 + review P2-2: the two arm points no
  // longer share one budget).
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

/**
 * PLAN S1.1 (2026-09-16): the watchdog used to arm min(reviewTimeoutMs,
 * REVIEW_SETTLE_MARGIN_MS) AT the start call, so under the default 120s
 * timeout ANY real review slower than 5s was killed as "unsettled" while its
 * abort deadline was still far ahead — the whole subagent channel degraded to
 * inject. Every S2-6 case above uses <=50ms budgets, where the defect is
 * invisible (the budget IS the timeout there). This case pins the intended
 * semantics at a default-scale timeout: a run that settles well within its
 * 120s budget is CONSUMED even though the fake clock crossed the old 5s mark
 * first. Fake timers advance exactly past the old watchdog fire time; under
 * the old formula this test is red (review-error + prompt fallback), under
 * the fixed one it is green.
 */
it('PLAN S1.1 (2026-09-16): a run settling within the review timeout is consumed — the 5s mark no longer abandons it', { timeout: 30_000 }, async () => {
  const delivered: string[] = []
  const collect = (message: unknown): void => {
    const box = message as { content?: Array<{ type: string; text: string }> } | null
    delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
  }
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  let currentTurn = 0
  const session = {
    id: SessionId('s1-1-real-latency'),
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
  // The run settles only when released below — AFTER the fake clock crossed
  // the old 5s watchdog mark. A real LLM review takes seconds, far inside the
  // 120s abort deadline the start signal gives it.
  type StubResult = { structured: { memoryOps: unknown[]; skillOps: unknown[]; summary: string }; stopReason: string }
  let releaseRun!: (value: StubResult) => void
  const runResult = new Promise<StubResult>((resolve) => { releaseRun = resolve })
  let starts = 0
  ctx.provide('subagents', { start: async () => { starts += 1; return { result: runResult, dispose: async () => {} } } })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: 'subagent' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: 1, reviewSkillInterval: 1, maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  // No `evolutionIo` mount on purpose: the zero-op plan needs no skill-tree
  // scan, and real FS IO would starve under the fake clock below — the whole
  // path to `subagents.start` must be pure promise work here.
  const errors: unknown[] = []
  ctx.on('evolution/review-error', (payload: unknown) => { errors.push(payload) })
  const scheduled: Array<{ channel?: string }> = []
  ctx.on('evolution/review-scheduled', (payload: unknown) => { scheduled.push(payload as { channel?: string }) })
  // Default-scale budget (the 0-config default): the OLD watchdog fired at
  // min(120s, 5s) = 5s after start; the fixed one at 120s + 5s.
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'subagent', reviewTimeoutMs: 120_000 })

  vi.useFakeTimers()
  try {
    emitEnd(1)
    // Walk the pipeline to the spawn on the fake clock WITHOUT crossing 5s
    // (pure promise work; the small fake steps just flush it).
    for (let waited = 0; starts === 0 && waited < 2_000; waited += 10) await vi.advanceTimersByTimeAsync(10)
    expect(starts).toBe(1)
    // Cross the OLD 5s watchdog mark while the run is still pending — this is
    // where the old implementation rejected with ReviewSettleTimeout. Stepped
    // in 1s slices so the exact timer-arm tick does not matter; under the old
    // formula the slice at ~5s fires it (errors grows, loop exits early and
    // the assertions below fail), under the fixed one nothing fires.
    for (let slices = 0; slices < 8 && errors.length === 0; slices += 1) await vi.advanceTimersByTimeAsync(1_000)
    // NOW the run settles: a structured zero-op plan, consumed end-to-end.
    releaseRun({ structured: { memoryOps: [], skillOps: [], summary: 'no-op' }, stopReason: 'completed' })
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    // The result notice (not the fallback prompt) was delivered, no
    // review-error was emitted, and the subagent channel was reported.
    expect(delivered.some(text => text.startsWith('💾 Self-improvement review: 0 ops landed'))).toBe(true)
    expect(errors).toEqual([])
    expect(scheduled.some(entry => entry.channel === 'subagent')).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

/**
 * PLAN-R2 P2-1 (2026-09-16): the settle budget used to be
 * reviewTimeoutMs + min(REVIEW_SETTLE_MARGIN_MS, reviewTimeoutMs) with NO
 * ceiling. A reviewTimeoutMs in (2^31-1 - 5000, 2^31-1] passes both the schema
 * and the assembly clamp (their bound IS the timer ceiling), and the sum
 * exceeded Node's 32-bit setTimeout bound — which silently folds to 1ms — so
 * EVERY review was abandoned as unsettled the moment the watchdog armed. The
 * result budget is now capped at MAX_TIMER_DELAY_MS. This case runs the exact
 * ceiling value: the run is held past several fake seconds (where the folded
 * 1ms watchdog of the old formula fired — red there, review-error + prompt
 * fallback) and must still be consumed end-to-end afterwards.
 */
it('PLAN-R2 P2-1 (2026-09-16): a reviewTimeoutMs at the int32 timer ceiling still consumes its run — the watchdog budget is capped, not folded to 1ms', { timeout: 30_000 }, async () => {
  const delivered: string[] = []
  const collect = (message: unknown): void => {
    const box = message as { content?: Array<{ type: string; text: string }> } | null
    delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
  }
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  let currentTurn = 0
  const session = {
    id: SessionId('p2-1-ceiling-budget'),
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: () => [{
      type: 'tool/call',
      data: { turn: currentTurn, step: 2, callId: 'c' + String(currentTurn), name: 'skill', arguments: '{}' },
    }],
    deriveMessages(): Array<{ role: string; content: Array<{ type: string; text: string }> }> { return [] },
  } as unknown as Session
  const agent = { id: session.id, session, inject: collect } as unknown as Agent
  ;(agent as { followup: unknown }).followup = collect
  ctx.agents.register(agent)
  const emitEnd = (turn: number): void => {
    currentTurn = turn
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  type StubResult = { structured: { memoryOps: unknown[]; skillOps: unknown[]; summary: string }; stopReason: string }
  let releaseRun!: (value: StubResult) => void
  const runResult = new Promise<StubResult>((resolve) => { releaseRun = resolve })
  let starts = 0
  ctx.provide('subagents', { start: async () => { starts += 1; return { result: runResult, dispose: async () => {} } } })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: 'subagent' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: 1, reviewSkillInterval: 1, maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  // No `evolutionIo` mount on purpose (same shape as the S1.1 case): the path
  // to `subagents.start` must be pure promise work under the fake clock.
  const errors: unknown[] = []
  ctx.on('evolution/review-error', (payload: unknown) => { errors.push(payload) })
  const scheduled: Array<{ channel?: string }> = []
  ctx.on('evolution/review-scheduled', (payload: unknown) => { scheduled.push(payload as { channel?: string }) })
  // The schema/clamp maximum itself: the old formula computed
  // 2_147_483_647 + 5_000 > 2^31-1 and the timer folded to 1ms.
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'subagent', reviewTimeoutMs: 2_147_483_647 })

  vi.useFakeTimers()
  try {
    emitEnd(1)
    // Walk the pipeline to the spawn on the fake clock (pure promise work).
    for (let waited = 0; starts === 0 && waited < 2_000; waited += 10) await vi.advanceTimersByTimeAsync(10)
    expect(starts).toBe(1)
    // Advance several fake seconds with the run still pending. Under the old
    // formula the folded 1ms watchdog fired within the very first step (red:
    // errors grows and the final assertions fail); under the cap the watchdog
    // is armed at the ceiling and nothing fires for the whole walk.
    for (let slices = 0; slices < 8 && errors.length === 0; slices += 1) await vi.advanceTimersByTimeAsync(1_000)
    expect(errors).toEqual([])
    // NOW the run settles: a structured zero-op plan, consumed end-to-end.
    releaseRun({ structured: { memoryOps: [], skillOps: [], summary: 'no-op' }, stopReason: 'completed' })
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    // The result notice (not the fallback prompt) was delivered, no
    // review-error was emitted, and the subagent channel was reported.
    expect(delivered.some(text => text.startsWith('💾 Self-improvement review: 0 ops landed'))).toBe(true)
    expect(errors).toEqual([])
    expect(scheduled.some(entry => entry.channel === 'subagent')).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

/**
 * PLAN-R2 P2-2 (2026-09-16): the dispose watchdog reused the RESULT budget
 * (reviewTimeoutMs + margin), so a hung dispose held the single-flight flag
 * for the full ~two minutes under the default timeout, and its error carried
 * the "after the review timeout" anchor — false at that arm point, since
 * dispose arms AFTER the result settled. The dispose budget is now the grace
 * ALONE (min(REVIEW_SETTLE_MARGIN_MS, reviewTimeoutMs)) and its message drops
 * the anchor. This case settles the result immediately and hangs ONLY dispose:
 * under the shared budget the finally stays parked past the whole observation
 * window (red — no report, no flag reset, no second run); under the
 * grace-only budget the handle is abandoned at ~5s, the failure is reported,
 * and the next boundary starts a NEW run.
 */
it('PLAN-R2 P2-2 (2026-09-16): a hung dispose is abandoned after the settle margin alone, reported without the timeout anchor, and the flag recovers', { timeout: 30_000 }, async () => {
  const delivered: string[] = []
  const collect = (message: unknown): void => {
    const box = message as { content?: Array<{ type: string; text: string }> } | null
    delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
  }
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  let currentTurn = 0
  const session = {
    id: SessionId('p2-2-hung-dispose'),
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: () => [{
      type: 'tool/call',
      data: { turn: currentTurn, step: 2, callId: 'c' + String(currentTurn), name: 'skill', arguments: '{}' },
    }],
    deriveMessages(): Array<{ role: string; content: Array<{ type: string; text: string }> }> { return [] },
  } as unknown as Session
  const agent = { id: session.id, session, inject: collect } as unknown as Agent
  ;(agent as { followup: unknown }).followup = collect
  ctx.agents.register(agent)
  const emitEnd = (turn: number): void => {
    currentTurn = turn
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  type StubResult = { structured: { memoryOps: unknown[]; skillOps: unknown[]; summary: string }; stopReason: string }
  const settledResult: StubResult = { structured: { memoryOps: [], skillOps: [], summary: 'no-op' }, stopReason: 'completed' }
  let starts = 0
  // The result resolves immediately; dispose NEVER settles — the hang is
  // isolated to the dispose arm point.
  ctx.provide('subagents', {
    start: async () => {
      starts += 1
      return { result: Promise.resolve(settledResult), dispose: (): Promise<void> => new Promise<void>(() => {}) }
    },
  })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: 'subagent' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: 1, reviewSkillInterval: 1, maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  const warns: string[] = []
  const originalWarn = ctx.logger.warn.bind(ctx.logger)
  ctx.logger.warn = ((message: string) => { warns.push(message); originalWarn(message) }) as typeof ctx.logger.warn
  // Default-scale budget: the old shared dispose bound was 120s + 5s; the new
  // one is the 5s margin alone.
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'subagent', reviewTimeoutMs: 120_000 })

  vi.useFakeTimers()
  try {
    emitEnd(1)
    // Walk the pipeline to the spawn (pure promise work), then flush the rest
    // of the happy path — including the dispose arm point — on the fake clock.
    for (let waited = 0; starts === 0 && waited < 2_000; waited += 10) await vi.advanceTimersByTimeAsync(10)
    expect(starts).toBe(1)
    for (let slices = 0; slices < 4; slices += 1) await vi.advanceTimersByTimeAsync(1_000)
    // The result leg was consumed normally despite the hung dispose.
    expect(delivered.some(text => text.startsWith('💾 Self-improvement review: 0 ops landed'))).toBe(true)
    // Cross the 5s grace (6s total): the hung dispose is abandoned and the
    // failure is reported — under the old shared budget (125s) nothing fired
    // inside this window (red: no warn at all).
    await vi.advanceTimersByTimeAsync(2_000)
    expect(warns.some(message => message.includes('subagent dispose did not settle within 5000ms'))).toBe(true)
    // The dispose message must NOT carry the result arm point's anchor.
    expect(warns.some(message => message.includes('subagent dispose') && message.includes('after the review timeout'))).toBe(false)
    // The single-flight flag recovered: further boundaries start a NEW run.
    for (const turn of [2, 3]) emitEnd(turn)
    for (let waited = 0; starts === 1 && waited < 2_000; waited += 10) await vi.advanceTimersByTimeAsync(10)
    expect(starts).toBe(2)
  } finally {
    vi.useRealTimers()
  }
})
