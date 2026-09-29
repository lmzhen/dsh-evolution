/**
 * 未结窗口：一条复查通知从投递到结清的整条生命周期（A 记录／B 时钟／C 闸门 的合成验收）。
 *
 * - 记录由平台队列的三条活事件建立：`agent/inbox/inserted`（排队了）／`claimed`（被某回合取走）／
 *   `discarded`（被队列丢掉）。
 * - 时钟只在那条通知真的离队时清零：被丢掉立刻清，被取走则等取走它的那个回合结束（那个回合不计数）。
 * - 闸门在投递复查提示前先看记录：命中即视为已投递，调用方的闩锁照常消费，队列不再增长。
 *
 * 这里断言的是端到端行为（队列里几条、投了几次）——计数记录本身在 review.spec.ts 的两个 B 用例里。
 * 假队列按平台 `agent-loop/src/inbox.ts` 的 `mutate()` 发同样的三条事件；闸门认的正是这些事件
 * 建起来的记录，所以一个只记账、不发事件的桩测不出闸门（旧 `inbox-replace-wake` 就是那种桩）。
 */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Review from '../src/index.ts'

interface WindowFixture {
  rows: { turn: unknown[]; step: unknown[] }
  delivered: string[]
  scheduled: Array<{ kind?: string; channel?: string }>
  /** Every `info`/`warn` line the plugin logged (the settle attributions). */
  logs: string[]
  emitEnd: (turn: number) => void
  /** The driver claiming the head of next-turn, as the platform's `claim()` does. */
  claim: (turn: number) => void
  /** The queue dropping a row (`remove`/`clear`/`replace`) — the user deleting it. */
  drop: () => void
  setMode: (mode: 'inject' | 'subagent') => void
}

async function mountWindow(options: { seededTurn?: unknown[] } = {}): Promise<WindowFixture> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const delivered: string[] = []
  const scheduled: Array<{ kind?: string; channel?: string }> = []
  const logs: string[] = []
  const rows: { turn: unknown[]; step: unknown[] } = { turn: [...options.seededTurn ?? []], step: [] }
  // The plugin logs the settle attribution at info (and the missed-event case at
  // warn); the spy replaces the level so the suite stays quiet.
  for (const level of ['info', 'warn'] as const) {
    vi.spyOn(ctx.logger, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(value => String(value)).join(' '))
    })
  }
  // Each emitted boundary must present a NEW tool call: the cadence fold reads
  // the session snapshot, so a static array would count once and never fire again.
  let currentTurn = 0
  const session = {
    id: SessionId('window-fixture-session'),
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: () => [{
      type: 'tool/call',
      data: { turn: currentTurn, step: 2, callId: 'c' + String(currentTurn), name: 'skill', arguments: '{}' },
    }],
    deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
  } as unknown as Session
  const collect = (message: unknown): void => {
    const box = message as { content?: Array<{ type: string; text?: string }> } | null
    delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text ?? '' : '')
  }
  const emitQueue = (event: string, payload: Record<string, unknown>): void => {
    ;(ctx.emit as (name: string, data: unknown) => void)(event, { agent, ...payload })
  }
  // The platform queue as the plugin reads it: the message really is appended,
  // and the append publishes `agent/inbox/inserted` (inbox.ts mutate()).
  const agent = {
    id: session.id,
    session,
    inbox: {
      get nextTurn(): readonly unknown[] { return rows.turn },
      get nextStep(): readonly unknown[] { return rows.step },
    },
    followup: (message: unknown): void => { rows.turn.push(message); collect(message); emitQueue('agent/inbox/inserted', { message }) },
    inject: (message: unknown): void => { rows.step.push(message); collect(message); emitQueue('agent/inbox/inserted', { message }) },
  } as unknown as Agent
  ctx.agents.register(agent)
  ctx.provide('subagents', {
    start: async () => ({
      result: Promise.resolve({ structured: { memoryOps: [], skillOps: [], summary: 'ok' } }),
      dispose: async () => {},
    }),
  })
  ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
  ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
  const state: { current: unknown } = { current: null }
  ctx.provide('evolutionState', {
    loadReviewState: async () => state.current,
    saveReviewState: async (_id: string, record: unknown) => { state.current = record },
  })
  const mode: { current: 'inject' | 'subagent' } = { current: 'inject' }
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: mode.current, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: 1, reviewSkillInterval: 1,
      maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  ctx.on('evolution/review-scheduled', (payload: unknown) => { scheduled.push(payload as { kind?: string; channel?: string }) })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'inject', reviewTimeoutMs: 2_000 })
  const emitEnd = (turn: number): void => {
    currentTurn = turn
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  const claim = (turn: number): void => {
    for (const message of rows.turn.splice(0, 1)) emitQueue('agent/inbox/claimed', { message, turn })
  }
  const drop = (): void => {
    const gone = [...rows.turn.splice(0), ...rows.step.splice(0)]
    for (const message of gone) emitQueue('agent/inbox/discarded', { message })
  }
  return { rows, delivered, scheduled, logs, emitEnd, claim, drop, setMode: (next) => { mode.current = next } }
}

it('D: a record whose notice is gone from the queue settles (a lost event must not wedge the gate)', { timeout: 30_000 }, async () => {
  const fixture = await mountWindow()
  fixture.emitEnd(1)
  await vi.waitFor(() => { expect(fixture.rows.turn).toHaveLength(1) })
  // The row leaves the queue without its `discarded\` notification ever arriving
  // (a dropped event, a host that went away mid-flight): the record still says
  // "queued", and without this fallback the gate would never open again.
  fixture.rows.turn.splice(0)
  fixture.emitEnd(2)
  await vi.waitFor(() => { expect(fixture.delivered).toHaveLength(2) })
  expect(fixture.rows.turn).toHaveLength(1)
  expect(fixture.logs.some(line => line.includes('(queue-lost)'))).toBe(true)
})

it('D: a restart rebuilds the record from the queue — a notice still queued is still outstanding', { timeout: 30_000 }, async () => {
  // The shape a restart leaves behind: the queue is durable and still holds our
  // notice, the plugin's in-memory record is gone (this mount never saw the
  // `inserted\` notification). Without the rebuild the first boundary would queue
  // a second copy.
  const fixture = await mountWindow({
    seededTurn: [{
      id: 'restart-notice',
      source: { kind: 'plugin', plugin: 'dsh-evolution-review', form: 'notice', summary: 'auto-review:combined' },
    }],
  })
  fixture.emitEnd(1)
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(fixture.delivered).toHaveLength(0)
  expect(fixture.rows.turn).toHaveLength(1)
  // The rebuilt record is a real one: claiming it and ending that turn settles it.
  fixture.claim(4)
  fixture.emitEnd(4)
  await vi.waitFor(() => { expect(fixture.logs.some(line => line.includes('(turn-end)'))).toBe(true) })
  fixture.emitEnd(5)
  await vi.waitFor(() => { expect(fixture.delivered).toHaveLength(1) })
})

const promptRow = (fixture: WindowFixture): { id?: unknown; source?: { summary?: string } } =>
  fixture.rows.turn[0] as { id?: unknown; source?: { summary?: string } }

it('C: a boundary that arrives while our notice is still queued delivers nothing (one row, no wake stub)', { timeout: 30_000 }, async () => {
  const fixture = await mountWindow()
  fixture.emitEnd(1)
  await vi.waitFor(() => { expect(fixture.rows.turn).toHaveLength(1) })
  expect(fixture.delivered).toHaveLength(1)
  // A long session keeps completing while the model never gets to the queued
  // prompt: every one of those boundaries used to append a fresh copy (or, after
  // 0.3.81, swap the row and append a wake stub behind it).
  for (const turn of [2, 3, 4, 5]) fixture.emitEnd(turn)
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(fixture.rows.turn).toHaveLength(1)
  expect(fixture.rows.step).toHaveLength(0)
  expect(fixture.delivered).toHaveLength(1)
  expect(fixture.scheduled).toHaveLength(1)
  const row = promptRow(fixture)
  expect(row.source?.summary).toBe('auto-review:combined')
  expect(String(row.source?.summary)).not.toContain('(wake)')
})

it('C: the queue dropping the notice reopens the window — the next boundary delivers', { timeout: 30_000 }, async () => {
  const fixture = await mountWindow()
  fixture.emitEnd(1)
  await vi.waitFor(() => { expect(fixture.rows.turn).toHaveLength(1) })
  // The user deleted the queued row (session-controller 'remove' → inbox.remove
  // → splice(discardRemoved) → `agent/inbox/discarded`).
  fixture.drop()
  expect(fixture.rows.turn).toHaveLength(0)
  expect(fixture.logs.some(line => line.includes('(discarded)'))).toBe(true)
  fixture.emitEnd(2)
  await vi.waitFor(() => { expect(fixture.delivered).toHaveLength(2) })
  expect(fixture.rows.turn).toHaveLength(1)
})

it('C: the turn that claims our notice is not counted, and the window reopens after it ends', { timeout: 30_000 }, async () => {
  const fixture = await mountWindow()
  fixture.emitEnd(1)
  await vi.waitFor(() => { expect(fixture.rows.turn).toHaveLength(1) })
  // V7-02: the woken turn runs OUR prompt, so its own cadence cross must not
  // fire a second review (interval=1 would otherwise chain forever). The claim
  // names the turn — no ordering heuristic is involved any more.
  fixture.claim(7)
  fixture.emitEnd(7)
  await vi.waitFor(() => { expect(fixture.logs.some(line => line.includes('(turn-end)'))).toBe(true) })
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(fixture.delivered).toHaveLength(1)
  expect(fixture.scheduled).toHaveLength(1)
  // The claiming turn settled the window, so the next boundary is a fresh start.
  fixture.emitEnd(8)
  await vi.waitFor(() => { expect(fixture.delivered).toHaveLength(2) })
  expect(fixture.rows.turn).toHaveLength(1)
})

it('C: a host without an inbox has no queue events to wait for — delivery still settles the window', { timeout: 30_000 }, async () => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const delivered: unknown[] = []
  const session = {
    id: SessionId('window-no-inbox'),
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: () => [{ type: 'tool/call', data: { turn: 0, step: 2, callId: 'c0', name: 'skill', arguments: '{}' } }],
    deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
  } as unknown as Session
  const agent = {
    id: session.id,
    session,
    inject: (message: unknown) => { delivered.push(message) },
    followup: (message: unknown) => { delivered.push(message) },
  } as unknown as Agent
  ctx.agents.register(agent)
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: 'inject' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: 1, reviewSkillInterval: 1,
      maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  const logs: string[] = []
  vi.spyOn(ctx.logger, 'info').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(value => String(value)).join(' '))
  })
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'inject' })
  const emitEnd = (turn: number): void => {
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  emitEnd(1)
  await vi.waitFor(() => { expect(delivered).toHaveLength(1) })
  // No queue ⇒ no claim/discard can ever arrive ⇒ the delivery itself closes the
  // window (the degradation the README documents): the next boundary delivers again.
  expect(logs.some(line => line.includes('(delivery-no-inbox)'))).toBe(true)
  emitEnd(2)
  await vi.waitFor(() => { expect(delivered).toHaveLength(2) })
})

it('C: the gate only guards review PROMPTS — a result notice still goes out while one is queued', { timeout: 30_000 }, async () => {
  const fixture = await mountWindow()
  // Boundary 1 delivers a review prompt; the model has not read it yet, so the
  // session has an outstanding notice for the whole test.
  fixture.emitEnd(1)
  await vi.waitFor(() => { expect(fixture.rows.turn).toHaveLength(1) })
  expect(fixture.delivered).toHaveLength(1)
  // Boundary 2 runs the review through the subagent channel and reports its
  // outcome to the model: '💾 Self-improvement review: …' is NOT a review prompt,
  // so the gate must not swallow it (the model has to learn what landed).
  fixture.setMode('subagent')
  fixture.emitEnd(2)
  await vi.waitFor(() => {
    expect(fixture.delivered.some(text => text.startsWith('💾 Self-improvement review:'))).toBe(true)
  }, { timeout: 15_000 })
  expect(fixture.logs.some(line => line.includes('(subagent-flush)'))).toBe(true)
})
