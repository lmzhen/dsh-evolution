import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { foldTurn, nodeEvolutionIo, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionPlanAppliedEvent } from '@deepseek-ai/dsh-evolution-core'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionCurator from '@deepseek-ai/dsh-evolution-curator'
import * as Review from '../src/index.ts'
import { tempHome } from '../../test-support/temp-home.ts'

/**
 * G0.3 (v33, platform 0.1.5): the accessor migration needs a case that reads a
 * REAL platform Session. Every other session-touching suite in this family
 * drives a hand-built `as never` stand-in, so a platform accessor swap —
 * 0.1.5 removed the `Session.events` getter in favour of
 * `Session.snapshotEvents()` — leaves them green while every production read
 * path throws at runtime. This ONE case drives the three real readers over one
 * real session log:
 *
 *  1. `foldTurn` (evolution-core) — the review signal fold.
 *  2. `recentSessionActive` (evolution-curator) — the pre-run idle gate, reached
 *     through the curator's public `run()`.
 *  3. `collectReadSkillNames` (evolution-review) — the read-before-write credit,
 *     observed through the plan the review actually applies.
 *
 * Reverting any of the three to `.events` makes this file fail: the first two
 * throw a TypeError, the third silently stops crediting the read and the plan op
 * is filtered out as unread.
 */

const REVIEWER = 'I prefer concise answers and want you to remember that preference. '.repeat(6)

/** A skill body carrying the frontmatter the library validates. */
const SKILL = (name: string): string =>
  `---
name: ${name}
description: Fixture skill for the accessor regression.
---

Body of ${name}.
`

describe('G0.3: the migrated session accessor reads a real session log', () => {
  it('foldTurn, the curator idle gate and the review read credit all see a real Session', { timeout: 30_000 }, async () => {
    await tempHome('dsh-session-accessor-')
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const library = new SkillLibrary(undefined, nodeEvolutionIo())
    // The registry MUST share the library's root: the schemastery default
    // `root: ''` is not nullish, so a bare mount silently disconnects them.
    await ctx.plugin(SkillUsageRegistry, { root: library.root })
    await library.create('target-skill', SKILL('target-skill'), 'foreground')

    // A stateful curator stub whose baseline is older than intervalHours, so
    // the run reaches the idle gate instead of the first-run defer.
    ctx.provide('evolutionState', {
      loadReviewState: async () => null,
      saveReviewState: async () => {},
      loadCuratorState: async () => ({ schemaVersion: 1, lastRunAt: Date.now() - 25 * 3_600_000, runCount: 3, paused: false, lastSummary: '' }),
      saveCuratorState: async () => {},
      transactCuratorState: async () => {},
      listPending: async () => [],
      savePending: async () => {},
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
    })
    const applied: EvolutionPlanAppliedEvent[] = []
    ctx.on('evolution/plan-applied', (event) => { applied.push(event) })
    ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({
          structured: {
            summary: 'update the skill the session read',
            skillOps: [{
              action: 'update',
              name: 'target-skill',
              content: `${SKILL('target-skill')}\nUpdated by the G0.3 accessor regression.\n`,
              evidence: [{ event_seq: 1 }],
            }],
          },
        }),
        localAgent: null,
        dispose: async () => {},
      }),
    })
    ctx.provide('evolutionPolicy', {
      get: () => ({ maxOpsPerPlan: 10, protectedSkillNames: [], skillContentChars: 100_000 }),
    })
    // BOTH readers mount before the session exists: the review's per-session
    // counters start from the first event it observes, so a late mount would
    // miss the threshold boundary (the V6-53 stash-then-flush cadence).
    await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24, minIdleHours: 1 })
    await ctx.plugin(Review, {
      reviewEnabled: true,
      reviewMode: 'subagent',
      memoryInterval: 1,
      skillInterval: 1,
    })

    const session = ctx.sessions.create(SessionId('session-accessor-g03'))
    ctx.agents.register({
      id: session.id,
      session,
      ctx,
      inject: () => {},
    } as unknown as Agent)

    // A REAL log: the read pair read-before-write credits, a substantive user
    // turn, and the completed boundaries the review fires on.
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1,
      step: 0,
      callId: ToolCallId('read-target-skill'),
      name: 'skill',
      arguments: JSON.stringify({ action: 'read', name: 'target-skill' }),
    })
    session.append('tool/result', {
      turn: 1,
      step: 0,
      message: createToolResultMessage({
        callId: ToolCallId('read-target-skill'),
        content: [{ type: 'text', text: 'skill loaded' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: REVIEWER }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // ── 1. evolution-core `foldTurn` over the real log ───────────────────────
    // `substantive` is decided later by `advanceReview` against the plate's
    // thresholds, so it stays false here: foldTurn's own output is the counters.
    const signals = foldTurn(session, 0)
    expect(signals.toolCalls).toBe(1)
    expect(signals.skillSignal).toBe(true)
    expect(signals.userChars).toBeGreaterThan(0)

    // ── 2. evolution-curator pre-run gate (`recentSessionActive`) ─────────────
    const curatorRun = await ctx.evolutionCurator.run()
    expect(curatorRun.skipped).toBe('active-session')

    // ── 3. evolution-review read credit (`collectReadSkillNames`) ─────────────
    // The threshold turn only STASHES the kind — the subagent runs at the NEXT
    // completed boundary.
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    // The skill op survives ONLY if the read credit saw the real tool/result
    // pair: `filterUnreadSkillOps` drops an update of an unread skill.
    await expect.poll(() => applied.length, { timeout: 10_000, interval: 50 }).toBeGreaterThan(0)
    expect(applied[0]).toMatchObject({ sessionId: 'session-accessor-g03', skillApplied: 1 })
  })
})
