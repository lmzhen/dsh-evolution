/**
 * S2-9 (FLOW1-5): the cadence suppression belongs to the turn the delivery WOKE.
 *
 * The delivery arms it so the woken turn's own review prompt cannot re-trigger a
 * review under interval=1. It used to be consumed by whichever turn ended NEXT:
 * in a busy period an unrelated turn that started BEFORE the delivery and merely
 * finished after it ate the suppression, and the woken turn then fired a second
 * review. The platform exposes only `{ turn }` on turn/start, so the binding is
 * the ordering it does expose — a turn may consume the suppression only if it
 * STARTED after the delivery was armed.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Review from '../src/index.ts'

/** Default thresholds (3 tool calls / 200 user chars) reached by the fixture. */
const SURFACE = [
  { role: 'user', content: [{ type: 'text', text: 'u'.repeat(220) }] },
  { role: 'assistant', content: [{ type: 'text', text: 'a'.repeat(520) }] },
]

async function fixture() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const delivered: unknown[] = []
  const session = {
    id: SessionId('s2-9-cadence-session'),
    seq: 1,
    header: { origin: undefined },
    snapshotEvents: () => [
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{}' } },
      { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'skill', arguments: '{}' } },
      { type: 'tool/call', data: { turn: 1, step: 3, callId: 'c3', name: 'skill', arguments: '{}' } },
    ],
    deriveMessages: () => SURFACE,
  } as unknown as Session
  // Prototype methods reaching `this`, like the platform's ReactLoopAgent: the
  // wake path (`followup`) is what arms the suppression at all.
  const agent = new (class {
    readonly id = session.id
    readonly session = session
    inject(message: unknown): void { this.forward(message) }
    followup(message: unknown): void { this.forward(message) }
    forward(message: unknown): void { delivered.push(message) }
  })() as unknown as Agent
  ctx.agents.register(agent)
  await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1 })
  const emitStart = (turn: number): void => {
    ctx.emit('session/event', session, { type: 'turn/start', data: { turn } } as never)
  }
  const emitEnd = (turn: number): void => {
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as never)
  }
  return { ctx, session, delivered, emitStart, emitEnd }
}

describe('cadence suppression binding (S2-9, FLOW1-5)', () => {
  it('a busy-period turn that started BEFORE the delivery does not consume the woken-turn suppression', { timeout: 30_000 }, async () => {
    const { delivered, emitStart, emitEnd } = await fixture()
    emitStart(1)
    emitEnd(1)
    // The unrelated turn STARTS before the (asynchronous) delivery lands, so it
    // is already in flight when the suppression is armed.
    emitStart(2)
    await vi.waitFor(() => { expect(delivered).toHaveLength(1) }, { timeout: 15_000 })
    emitEnd(2)
    // Its end must NOT consume the suppression: turn 2 is a legitimate busy
    // boundary and still fires its own cadence review.
    await vi.waitFor(() => { expect(delivered).toHaveLength(2) }, { timeout: 15_000 })
    // The turn that started AFTER the delivery is the woken one: suppressed.
    emitStart(3)
    emitEnd(3)
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(delivered).toHaveLength(2)
  })

  it('a turn that starts after the delivery consumes it (the control)', { timeout: 30_000 }, async () => {
    const { delivered, emitStart, emitEnd } = await fixture()
    emitStart(1)
    emitEnd(1)
    await vi.waitFor(() => { expect(delivered).toHaveLength(1) }, { timeout: 15_000 })
    // No unrelated start here: this turn IS the woken turn.
    emitStart(2)
    emitEnd(2)
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(delivered).toHaveLength(1)
  })
})
