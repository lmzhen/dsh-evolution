/**
 * PLAN S4.1 (2026-09-16, audit P2-11): the inbox `replace` coalescing path
 * must keep the CHANNEL semantics of the row it swaps in — the queue a row
 * sits in is the only record of its original delivery channel (`followup`
 * queues `next-turn` and wakes the driver, `inject` queues `next-step` and
 * never wakes). The contract pinned here: every `true` deliverMessage returns
 * means "the queue holds a prompt as consumable as the channel that
 * originally queued it", because callers consume their one-shot latch and the
 * cadence counter reset on that return:
 * - (a) a superseded `next-turn` (waking) row is re-armed with a followup
 *   wake after the in-place replace, and the woken-turn cadence suppression
 *   mirrors the append path;
 * - (b) a superseded `next-step` (inject) row keeps the no-wake `true` — the
 *   documented inject bound (README, "Known limitations"):
 *   a pending prompt may wait for the next real user input while the latch
 *   stays consumed.
 */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Review from '../src/index.ts'

interface FakeInbox {
  rows: { turn: unknown[]; step: unknown[] }
  counters: { wakes: number; injects: number }
  like: {
    readonly nextTurn: readonly unknown[]
    readonly nextStep: readonly unknown[]
    replace(messageId: unknown, message: unknown): boolean
  }
  deliver: { followup(message: unknown): void; inject(message: unknown): void }
}

function createFakeInbox(): FakeInbox {
  const rows: { turn: unknown[]; step: unknown[] } = { turn: [], step: [] }
  const counters = { wakes: 0, injects: 0 }
  const like = {
    get nextTurn(): readonly unknown[] { return rows.turn },
    get nextStep(): readonly unknown[] { return rows.step },
    replace(messageId: unknown, message: unknown): boolean {
      for (const list of [rows.turn, rows.step]) {
        const index = list.findIndex(row => (row as { id?: unknown }).id === messageId)
        if (index >= 0) {
          list.splice(index, 1, message)
          return true
        }
      }
      return false
    },
  }
  const deliver = {
    followup: (message: unknown): void => { rows.turn.push(message); counters.wakes += 1 },
    inject: (message: unknown): void => { rows.step.push(message); counters.injects += 1 },
  }
  return { rows, counters, like, deliver }
}

async function mount(label: string, pluginConfig: Record<string, unknown> = {}): Promise<{
  box: FakeInbox
  scheduled: Array<{ kind?: string; channel?: string }>
  emitEnd: (turn: number) => void
}> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const id = SessionId(label)
  const session = {
    id,
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: (): unknown[] => [{
      type: 'tool/call',
      data: { turn: 0, step: 2, callId: `${label}-0`, name: 'skill', arguments: '{}' },
    }],
    deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
  } as unknown as Session
  const box = createFakeInbox()
  const agent = {
    id,
    session,
    ctx,
    inbox: box.like,
    followup: (message: unknown) => { box.deliver.followup(message) },
    inject: (message: unknown) => { box.deliver.inject(message) },
  } as unknown as Agent
  ctx.agents.register(agent)
  // The default substantive bar (3 tool calls) would never fire on the
  // one-tool-call fold; the policy snapshot lowers it like the shipped rows do.
  ctx.provide('evolutionPolicy', {
    get: () => ({
      reviewMode: 'inject' as const, substantiveMinToolCalls: 1, substantiveMinUserChars: 0, substantiveMinAgentChars: 0,
      reviewMemoryInterval: 1, reviewSkillInterval: 999,
      maxOpsPerPlan: 5, protectedSkillNames: [] as string[],
      memoryChars: 10_000, userChars: 10_000, skillContentChars: 10_000,
      memoryReviewModel: 'model-x', skillReviewModel: 'model-x',
    }),
  })
  const scheduled: Array<{ kind?: string; channel?: string }> = []
  ctx.on('evolution/review-scheduled', (payload: unknown) => { scheduled.push(payload as { kind?: string; channel?: string }) })
  const emitEnd = (turn: number): void => {
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  await ctx.plugin(Review, { reviewEnabled: true, reviewMode: 'inject', memoryInterval: 1, skillInterval: 999, ...pluginConfig })
  return { box, scheduled, emitEnd }
}

it('P2-11 (a): a repeated followup-kind delivery replaces the pending row AND re-arms the wake', { timeout: 30_000 }, async () => {
  const fixture = await mount('p2-11-followup')
  fixture.emitEnd(1)
  await vi.waitFor(() => { expect(fixture.box.counters.wakes).toBe(1) }, { timeout: 15_000 })
  expect(fixture.box.rows.turn).toHaveLength(1)
  // The turn the delivery woke has its cadence fire suppressed once (V7-02).
  fixture.emitEnd(2)
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(fixture.box.counters.wakes).toBe(1)
  // Turn 3 fires again while the first prompt row is still pending — coalescing.
  const firstPrompt = fixture.box.rows.turn[0]
  fixture.emitEnd(3)
  await vi.waitFor(() => {
    // The replaced row entered through the WAKING channel: the swap is
    // followed by a fresh followup wake (the P2-11 fix).
    expect(fixture.box.counters.wakes).toBe(2)
    expect(fixture.box.rows.turn).toHaveLength(2)
  }, { timeout: 15_000 })
  expect(fixture.box.rows.turn[0]).not.toBe(firstPrompt)
  expect(fixture.box.counters.injects).toBe(0)
  // `true` twice — the caller consumed the latch/cadence reset twice, and the
  // queue really holds the consumable prompt both times.
  await vi.waitFor(() => { expect(fixture.scheduled).toHaveLength(2) }, { timeout: 15_000 })
  // The re-armed wake mirrors the append path's one-shot cadence suppression.
  fixture.emitEnd(4)
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(fixture.box.counters.wakes).toBe(2)
})

/**
 * PLAN-R2 P1-1 (2026-09-16): the replace path's re-armed wake used to arm the
 * append path's SINGLE one-shot suppression. The platform claims ONE next-turn
 * per driver round (agent-loop/src/inbox.ts:113), so the wake produces TWO
 * turns: the refreshed prompt claimed first, then the wake stub appended behind
 * it (212 chars — above the substantive bar). Once the first turn consumed the
 * suppression, the stub turn was free to fire a whole extra review when the
 * cadence came due. The replace path now arms `turns: 2`; the fake driver below
 * claims one row per round exactly like the platform. Under the single-entry
 * implementation the stub turn (turn 5) fires and coalesces again — red there
 * (wakes/scheduled grow); under the fix both woken turns are suppressed and
 * only the third, unclaimed-by-us turn re-arms cadence.
 */
it('PLAN-R2 P1-1 (2026-09-16): the replace wake suppresses BOTH woken turns — the refreshed-prompt turn, then the stub turn', { timeout: 30_000 }, async () => {
  const fixture = await mount('p1-1-two-claims')
  fixture.emitEnd(1)
  await vi.waitFor(() => { expect(fixture.box.counters.wakes).toBe(1) }, { timeout: 15_000 })
  // Turn 2 is the append path's woken turn: the one-shot suppression is
  // consumed there, before any replace happens.
  fixture.emitEnd(2)
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(fixture.box.counters.wakes).toBe(1)
  // Turn 3 fires while the prompt row is still pending: the replace path
  // re-arms the wake — the queue now holds [refreshed prompt, stub].
  const refreshedPrompt = fixture.box.rows.turn[0]
  fixture.emitEnd(3)
  await vi.waitFor(() => {
    expect(fixture.box.counters.wakes).toBe(2)
    expect(fixture.box.rows.turn).toHaveLength(2)
  }, { timeout: 15_000 })
  expect(fixture.box.rows.turn[0]).not.toBe(refreshedPrompt)
  await vi.waitFor(() => { expect(fixture.scheduled).toHaveLength(2) }, { timeout: 15_000 })
  // Driver round N+1 claims ONE next-turn (the head): the refreshed prompt.
  // Its turn ends — suppressed, and the entry must SURVIVE this hit
  // (`turns: 2` decrements) so the stub turn behind it stays covered.
  fixture.box.rows.turn.shift()
  fixture.emitEnd(4)
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(fixture.box.counters.wakes).toBe(2)
  expect(fixture.scheduled).toHaveLength(2)
  // Driver round N+2 claims the stub. Its turn ends — the SECOND and last
  // suppression hit. Under the single-entry implementation this turn found no
  // protection, fired cadence, and coalesced a fresh prompt + stub onto the
  // queue (red there: wakes/scheduled grow and the queue is non-empty).
  fixture.box.rows.turn.shift()
  fixture.emitEnd(5)
  await new Promise(resolve => setTimeout(resolve, 120))
  expect(fixture.box.counters.wakes).toBe(2)
  expect(fixture.scheduled).toHaveLength(2)
  expect(fixture.box.rows.turn).toHaveLength(0)
  // The control: the next turn is NOT suppressed — cadence re-arms normally.
  fixture.emitEnd(6)
  await vi.waitFor(() => { expect(fixture.box.counters.wakes).toBe(3) }, { timeout: 15_000 })
  expect(fixture.box.rows.turn).toHaveLength(1)
})

it('P2-11 (b): a repeated inject-kind delivery replaces in place, never wakes, and the latch consumption stays the documented inject contract', { timeout: 30_000 }, async () => {
  const fixture = await mount('p2-11-inject', { reviewWakeInject: false })
  fixture.emitEnd(1)
  await vi.waitFor(() => { expect(fixture.box.rows.step).toHaveLength(1) }, { timeout: 15_000 })
  expect(fixture.box.counters.wakes).toBe(0)
  // The inject channel sets no woken-turn suppression (it wakes nothing), so
  // EVERY completed boundary fires and coalesces onto the single pending row.
  const firstPrompt = fixture.box.rows.step[0]
  fixture.emitEnd(2)
  await vi.waitFor(() => {
    expect(fixture.box.rows.step).toHaveLength(1)
    expect(fixture.box.rows.step[0]).not.toBe(firstPrompt)
  }, { timeout: 15_000 })
  const secondPrompt = fixture.box.rows.step[0]
  fixture.emitEnd(3)
  await vi.waitFor(() => {
    expect(fixture.box.rows.step).toHaveLength(1)
    expect(fixture.box.rows.step[0]).not.toBe(secondPrompt)
  }, { timeout: 15_000 })
  // The agent HAS followup, but the superseded rows came from the inject
  // channel: the swaps keep the documented no-wake semantics.
  expect(fixture.box.counters.wakes).toBe(0)
  expect(fixture.box.counters.injects).toBe(1)
  // `true` per delivery — the latch consumption matches the README's inject
  // bound: one consumable prompt stays queued, wakeless by contract.
  await vi.waitFor(() => { expect(fixture.scheduled).toHaveLength(3) }, { timeout: 15_000 })
})
