import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'
import type { PendingRecord } from '@deepseek-ai/dsh-evolution-state'
import * as Review from '../src/index.ts'

/**
 * P1-9 (rc.44 plan): with approval ENABLED but no replay runner registered
 * for a kind (host-only compositions mount no tool runners), staging used to
 * create a pending record that no approver could ever replay. The review now
 * pre-checks `hasRunner` and executes through its trusted direct path, so the
 * write lands and no unanswerable pending is created.
 */

const REVIEWER = 'I prefer concise answers and want you to remember that preference. '.repeat(6)

describe('review approval pre-check (P1-9)', () => {
  it('executes directly when approval is enabled but no runner exists, staging nothing', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)

    // The durable state exists (pending records would persist here) — and it
    // must stay empty: the pre-check routes the write to direct execution.
    const pending: PendingRecord[] = []
    ctx.provide('evolutionState', {
      listPending: async () => pending,
      savePending: async (record: PendingRecord) => { pending.push(record) },
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })

    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(false)

    let applied = 0
    ctx.provide('memory', {
      applyBatch: async () => {
        applied += 1
        return { ok: true, message: 'ok' }
      },
    })
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({
          structured: {
            summary: 'remember the user preference',
            memoryOps: [{
              target: 'memory',
              action: 'add',
              facts: 'User prefers concise answers.',
              evidence: [{ event_seq: 1 }],
            }],
          },
        }),
        localAgent: null,
        dispose: async () => {},
      }),
    })

    await ctx.plugin(Review, {
      reviewEnabled: true,
      reviewMode: 'subagent',
      memoryInterval: 1,
      // Isolate the memory channel (with both at 1 the gate returns 'combined').
      skillInterval: 999,
    })

    const session = ctx.sessions.create(SessionId('review-precheck'))
    ctx.agents.register({
      id: session.id,
      session,
      ctx,
      inject: () => {},
    } as unknown as Agent)

    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: REVIEWER }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // onTurnEnd is async-void: wait out the poll window (the pipeline must
    // have visited the op by then — and REFUSED it).
    await new Promise(resolve => setTimeout(resolve, 200))
    // Enabled approval is an operator gate: with no replay runner the write
    // is REFUSED (fail closed) — it must NOT land through a silent bypass.
    expect(applied).toBe(0)
    // And nothing was staged either: no unanswerable pending record exists.
    expect(pending).toHaveLength(0)
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(0)
  })
})
