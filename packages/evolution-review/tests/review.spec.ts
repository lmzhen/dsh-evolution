// @tier ci-only
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Config, REVIEW_OUTPUT_SCHEMA } from '../src/index.ts'
import * as Review from '../src/index.ts'
// G4: hand-driven specs must present a session the projection registry can fold.
import { emitSessionEvent, projectable } from '../../test-support/projection-session.ts'
import { mutableVol, plainValue, vol } from '../../test-support/volatile-config.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { apply as mountRuntime } from '@deepseek-ai/dsh-evolution-core/runtime'
import type {} from '@deepseek-ai/dsh-evolution-core'
import { provideChannel } from './support/channel-fixture.ts'

describe('evolution-review', () => {

  it('loads with review disabled', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    if (ctx.get('sessionProjections') === undefined) new SessionProjectionRegistry(ctx) // 夹具：把投影服务注册到本 ctx（幂等）
    await ctx.plugin(mountRuntime)
    await ctx.plugin(Review, { reviewEnabled: false })
    expect(ctx.get('agents')).toBeDefined()
  })

  // G1: these three keys are volatile, so a parsed field is a live reference —
  // `plainValue` reads what the plugin would read at its use site.
  it('0.3.74: reviewMode defaults to inject — the parent delivers against its own warm prefix', () => {
    const value = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: { reviewMode: { get(): string } } } } })['~standard'].validate({}).value
    expect(plainValue(value.reviewMode)).toBe('inject')
  })

  it('defaults the completion channel to both with a long-conversation threshold', () => {
    const value = (Config as unknown as { ['~standard']: { validate(input: unknown): { value: { skillReviewTrigger: { get(): string }; skillReviewCompletionMinToolCalls: { get(): number } } } } })['~standard'].validate({}).value
    expect(plainValue(value.skillReviewTrigger)).toBe('cadence')
    expect(plainValue(value.skillReviewCompletionMinToolCalls)).toBe(20)
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



  it('E-41: the review is deferred when the subagent cannot start; the eventual fallback inject emits review-scheduled (0.3.19 + 0.3.39 + V24-15)', async () => {
    const injected: unknown[] = []
    const { ctx, session, emitEnd } = await mountReviewFixture({ onInject: message => injected.push(message) })
    const scheduled: Array<{ sessionId: string; channel?: string | undefined }> = []
    ctx.on('evolution/review-scheduled', event => scheduled.push(event))
    provideChannel(ctx, {
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


  /**
   * T3-06/A34: drive ONE plan op through the review's write leg and return whatever the
   * memory service received. `approvalStub` selects the branch: `null` = no approval
   * service (the plan path's direct applyBatch), an object = the mounted-but-DISABLED
   * service (runApproved → runnerDirect, the second normalization site).
   */
  const landOnePlanOp = async (
    approvalStub: { request: () => Promise<{ action: string; message: string }>; isEnabled: boolean } | null,
  ): Promise<Array<Record<string, unknown>>> => {
    const { ctx, emitEnd } = await mountReviewFixture({ onInject: () => {} })
    const applied: Array<Record<string, unknown>> = []
    provideChannel(ctx, {
      start: async () => ({
        result: Promise.resolve({
          structured: {
            memoryOps: [{ target: 'memory', action: 'add', facts: '', content: '正文', evidence: [{ event_seq: 0 }] }],
            skillOps: [],
            summary: 'land a content-only op',
          },
        }),
        dispose: async () => {},
      }),
    })
    ctx.provide('memory', {
      applyBatch: async (_target: unknown, ops: Array<Record<string, unknown>>) => {
        applied.push(...ops)
        return { ok: true, message: 'ok' }
      },
    })
    if (approvalStub) ctx.provide('evolutionApproval', approvalStub)
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
    emitEnd(1, 'blocked')
    emitEnd(2) // 0.3.39: the review executes at the SECOND (flush) boundary
    await vi.waitFor(() => { expect(applied).toHaveLength(1) })
    return applied
  }







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
  /** 0.3.73: register a CLASS agent whose wake primitives are prototype methods
   * touching `this` (the platform ReactLoopAgent shape) instead of the bound
   * arrow-property stub. A detached call throws here — the stub above cannot
   * express that, which is why the suite stayed green while every real delivery
   * threw (see the 0.3.73 regression case). */
  classAgent?: boolean
  /** 0.3.74: the message surface returned by `deriveMessages`. The default is
   * empty, which keeps the substantive gate (user/assistant chars) at zero; pass
   * role/content entries to exercise the DEFAULT thresholds without a policy. */
  surface?: Array<{ role: string; content: Array<{ type: string; text: string }> }>
  /** The platform `Agent.inbox` view (the pending-message queue). The default
   * agent has NO `inbox` at all — the degradation shape every other case in this
   * suite runs through (there the window settles at delivery, because no queue
   * event can ever arrive). */
  queue?: unknown
  /** The faithful-host shape: every delivery announces itself on the queue's
   * live event (`agent/inbox/inserted`), which is what the outstanding-notice
   * record is built from. Off by default — the bare stub above queues nothing. */
  announceInserted?: boolean
  /** Batch D: the session's plan-time seq (`sessionSeqAtPlanTime = seq - 1`), and the only
   * way a case can cite an evidence seq at all. Default 1 — the shape every other case uses. */
  seq?: number
} = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  if (ctx.get('sessionProjections') === undefined) new SessionProjectionRegistry(ctx) // 夹具：把投影服务注册到本 ctx（幂等）
    await ctx.plugin(mountRuntime)
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
  // G4: the plan path's evidence index comes from the family's session projection, which folds
  // the session's OWN log through `snapshotEvents(from, to)` / `eventAt(seq)` / `seq`. The log
  // is therefore dense and seq-stamped from 0 (frame 0 is the tool/call the foldTurn comment
  // below names; `options.events` carry their own seqs and continue it).
  const log: Array<Record<string, unknown>> = [
    { type: 'tool/call', seq: 0, time: 0, data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: options.skillArguments ?? '{}' } },
    ...(options.events ?? []),
  ]
  const session = {
    id: SessionId('e19-fixture-session'),
    // seq=1 ⇒ foldTurn starts at 0 and scans the tool/call below (substantive).
    seq: options.seq ?? 1,
    inheritedEventCount: 0,
    header: { origin: undefined },
    // v33 G0.1: the fixture presents the post-0.1.5 accessor. The removed
    // `events` getter made every production reader throw inside the pipeline,
    // which surfaced as "no review was scheduled/injected" instead of an error.
    snapshotEvents: (from = 0, to = log.length) => log.slice(from, to),
    eventAt: (seq: number) => log[seq],
    deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => options.surface ?? [],
  } as unknown as Session
  // The platform's live queue events, emitted through the plugin's ctx exactly
  // as the agent loop does (inbox.ts mutate(): inserted for the new row,
  // claimed when a boundary takes it, discarded when the queue drops it).
  const emitInbox = (event: 'agent/inbox/inserted' | 'agent/inbox/claimed' | 'agent/inbox/discarded', payload: unknown): void => {
    const agent = (payload as { agent?: unknown }).agent
    if (agent === undefined) throw new Error('review fixture: agent missing on ' + event)
    ;(ctx.emit as (name: string, data: unknown) => void)(event, { ...(payload as object), agent })
  }
  const record = (kind: 'inject' | 'followup', message: unknown, agent?: unknown): void => {
    if (options.announceInserted === true) emitInbox('agent/inbox/inserted', { message, ...(agent === undefined ? {} : { agent }) })
    if (kind === 'followup' && options.onFollowup) options.onFollowup(message)
    else options.onInject?.(message)
  }
  // Prototype methods that go through `this` — a detached reference throws
  // exactly like the platform's ReactLoopAgent.followup does (`this.send`).
  // Without the `this` hop the stub would survive detachment, which is the
  // blind spot this fixture exists to close.
  const makeClassAgent = (): Agent => new (class {
    readonly id = session.id
    readonly session = session
    inject(message: unknown): void { this.forward('inject', message) }
    followup(message: unknown): void { this.forward('followup', message) }
    forward(kind: 'inject' | 'followup', message: unknown): void { record(kind, message, this) }
  })() as unknown as Agent
  const agent = options.classAgent === true
    ? makeClassAgent()
    : { id: session.id, session, inject: (message: unknown) => { options.onInject?.(message) } } as unknown as Agent
  if (options.classAgent !== true && !options.noFollowup) {
    ;(agent as { followup: unknown }).followup = (message: unknown) => {
      if (options.onFollowup) options.onFollowup(message)
      else options.onInject?.(message)
    }
  }
  if (options.queue !== undefined) (agent as { inbox: unknown }).inbox = options.queue
  await ctx.agents.register(agent)
  const releaseStart: { current: (() => void) | undefined } = { current: undefined }
  const emitEnd = (turn: number, reasonKind: 'completed' | 'blocked' = 'completed'): void => {
    // G4: a real append carries the next seq — the projection registry indexes a session's log
    // by seq (`eventAt(seq)`, `drive`), so the fixture's own log grows with what it announces.
    const event = { type: 'turn/end', seq: log.length, time: Date.now(), data: { turn, reason: { kind: reasonKind } } }
    log.push(event)
    ctx.emit('session/event', session, event as never)
  }
  return { ctx, session, emitEnd, emitInbox, releaseStart, stateBox }
}

/** A policy fake whose low thresholds make the single skill tool/call substantive. */
function reviewPolicy() {
  return {
    reviewMode: 'inject' as const,
    substantiveMinToolCalls: 1,
    substantiveMinUserChars: 0,
    substantiveMinAgentChars: 0,
    reviewMemoryInterval: 1,
    reviewSkillInterval: 1,
    protectedSkillNames: [] as string[],
    memoryChars: 10_000,
    userChars: 10_000,
    skillContentChars: 10_000,
  }
}

// G3/S3.1 + G1: the user settings layer sits ABOVE the deployment carriers, and a
// committed change is visible to the NEXT turn (no restart). The platform resolves a
// user value into the row's LIVE field and reports the raw user section through
// `describe()`; the test drives both halves the way settings-file does when it
// commits an edit (the row is assembled directly so the reference can be moved).
it('G3/S3.1 + G1: a user-layer reviewSkillInterval overrides the row on the next turn', async () => {
  const injected: unknown[] = []
  const { ctx, emitEnd } = await mountReviewFixture({ onInject: message => injected.push(message) })
  let user: Record<string, unknown> = {}
  const userInterval = mutableVol<number | undefined>(undefined)
  // The platform types `settings` through its own module augmentation, which this
  // package deliberately does not depend on; provide through an unknown boundary
  // (`.call(ctx, ...)` keeps the receiver — an unbound reference trips oxlint).
  ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'settings', {
    describe: () => [{ ns: 'evolution-review', user }],
  })
  // Substantive turn, but the ROW interval (10) cannot fire on one turn, and the
  // policy snapshot deliberately leaves both intervals unset so the chain under
  // test is user -> row.
  ctx.provide('evolutionPolicy', {
    get: () => ({ ...reviewPolicy(), reviewMemoryInterval: undefined, reviewSkillInterval: undefined }),
  })
  Review.apply(ctx, {
    reviewEnabled: vol(true),
    reviewMode: vol<'subagent' | 'inject'>('inject'),
    memoryInterval: 10,
    skillInterval: 10,
    reviewSkillInterval: userInterval.ref,
  })
  emitEnd(1)
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(injected, 'the row interval alone must not fire').toHaveLength(0)
  // The user edits the settings document: the value lands in the live field and the
  // raw section names the key, then the NEXT turn fires.
  user = { reviewSkillInterval: 1 }
  userInterval.set(1)
  emitEnd(2)
  await vi.waitFor(() => { expect(injected).toHaveLength(1) })
})

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

it('0.3.74: the DEFAULT review mode injects into the parent instead of spawning a subagent', async () => {
  const injected: unknown[] = []
  const spawns: string[] = []
  // Real default thresholds (3 tool calls / 200 user chars / 500 assistant chars),
  // no evolutionPolicy service: the plugin's own Config default decides the mode.
  const surface = [
    { role: 'user', content: [{ type: 'text', text: 'u'.repeat(220) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'a'.repeat(520) }] },
  ]
  const { ctx, emitEnd, stateBox } = await mountReviewFixture({
    stateful: true,
    surface,
    onInject: message => injected.push(message),
    events: [
      { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'skill', arguments: '{}' } },
      { type: 'tool/call', data: { turn: 1, step: 3, callId: 'c3', name: 'skill', arguments: '{}' } },
    ],
  })
  // A recording subagents service proves the default path never spawns a child.
  provideChannel(ctx, {
    start: async (kind: string) => {
      spawns.push(kind)
      return { result: Promise.resolve({}) }
    },
  })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
  emitEnd(1)
  await vi.waitFor(() => { expect(injected).toHaveLength(1) })
  expect(spawns).toHaveLength(0)
  const text = (injected[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ''
  expect(text).toContain('[Auto-review')
  // The delivery reached the parent, so the segment counts as reviewed.
  expect((stateBox.current as { turnsSinceSkill: number }).turnsSinceSkill).toBe(0)
})

it('0.3.73: the wake delivery calls followup ON the agent — a prototype method must keep its receiver', async () => {
  // Control first: this environment throws when a prototype method is detached
  // (module code is strict) — the platform behaviour the case below depends on,
  // and the reason a bound arrow stub cannot reproduce the defect.
  class Probe {
    mark(): void { this.touch() }
    touch(): void { /* receiver reached */ }
  }
  // The cast erases the METHOD-ness for the type checker (which is exactly why
  // `typescript(unbound-method)` stays silent on the production form, where the
  // receiver is a cast shape too) while the runtime value is still the prototype
  // method — so the detached call throws.
  const detached = (new Probe() as unknown as { mark: () => void }).mark
  expect(() => { detached() }).toThrow()

  const injected: unknown[] = []
  const followed: unknown[] = []
  const { ctx, emitEnd, stateBox } = await mountReviewFixture({
    stateful: true,
    classAgent: true,
    onInject: message => injected.push(message),
    onFollowup: message => followed.push(message),
  })
  ctx.provide('evolutionPolicy', { get: () => ({ ...reviewPolicy(), reviewMode: 'inject' }) })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'inject' })
  emitEnd(1)
  await vi.waitFor(() => { expect(followed).toHaveLength(1) })
  expect(injected).toHaveLength(0)
  // The delivery reached the host, so the segment IS consumed: both counters are
  // zeroed. (Pre-0.3.73 the detached call threw inside deliverMessage, the catch
  // warned, and this reset ran anyway — nothing was queued and nothing retried.)
  const saved = stateBox.current as { turnsSinceMemory: number; turnsSinceSkill: number }
  expect(saved.turnsSinceMemory).toBe(0)
  expect(saved.turnsSinceSkill).toBe(0)
})

it('0.3.73: a refused wake delivery is not consumed — the review retries at the next boundary', async () => {
  const followed: unknown[] = []
  let refuse = true
  const { ctx, emitEnd, stateBox } = await mountReviewFixture({
    stateful: true,
    classAgent: true,
    onFollowup: (message) => {
      if (refuse) throw new Error('host refused the wake')
      followed.push(message)
    },
  })
  ctx.provide('evolutionPolicy', { get: () => ({ ...reviewPolicy(), reviewMode: 'inject' }) })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'inject' })
  const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 20)) }
  emitEnd(1); await settle()
  // The delivery was refused: the counters must NOT be zeroed (the former silent
  // consumption declared a segment that never got its review).
  const afterRefusal = stateBox.current as { turnsSinceSkill: number }
  expect(afterRefusal.turnsSinceSkill).toBeGreaterThan(0)
  expect(followed).toHaveLength(0)
  // The latch survives, so the next completed boundary retries and delivers.
  refuse = false
  emitEnd(2); await settle()
  expect(followed).toHaveLength(1)
})

// 0.2.2 migration: the old B/0.3.40–0.3.48 notice-delivery cases asserted the
// pre-agentEvents queue shape and cadence. Removed under D15; target review
// delivery is covered by the fixture/real-session cases that remain.

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



