/**
 * S2.2 (v37): the review channel's two LOAD-TIME disclosures.
 *
 * P2-24 — `reviewMode`/`memoryInterval`/`skillInterval` on the review row are
 * shadowed by the policy snapshot in every shipped composition, so the row used
 * to be configurable but silently ineffective.
 * P1-1(c) — the default 'inject' channel neither spawns the plan channel nor
 * emits `evolution/plan-applied`, so the activity/replay ledger stays empty by
 * design; that fact is disclosed once at load instead of read as "no reviews".
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Review from '../src/index.ts'
// G4: hand-driven specs must present a session the projection registry can fold.
import { emitSessionEvent, projectable } from '../../test-support/projection-session.ts'

/** Capture what the plugin logs during load — the disclosure surface. */
function captureWarns(ctx: Context): string[] {
  const warns: string[] = []
  const originalWarn = ctx.logger.warn.bind(ctx.logger)
  // Same capture idiom as evolution-learning-graph's graph.spec.ts — the cast
  // is on the whole arrow because the bound logger method takes rest args.
  ctx.logger.warn = ((message: string) => { warns.push(message); originalWarn(message) }) as typeof ctx.logger.warn
  return warns
}

const SHADOW_MARK = 'have no effect'
const LEDGER_MARK = 'NO evolution/plan-applied ledger entry'

async function load(rowConfig: Record<string, unknown>, policyReviewMode?: 'inject' | 'subagent', user?: Record<string, unknown>) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  if (policyReviewMode !== undefined) ctx.provide('evolutionPolicy', { get: () => ({ reviewMode: policyReviewMode }) })
  if (user !== undefined) {
    // G1: the settings user layer reaches the plugin two ways — the VALUE through the
    // row's live field, the KEY NAMES through `describe()`. This suite exercises the
    // naming half only; the value half needs a row assembled by hand (review.spec.ts).
    ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'settings', {
      describe: () => [{ ns: 'evolution-review', user }],
    })
  }
  const warns = captureWarns(ctx)
  await ctx.plugin(Review, { reviewEnabled: false, ...rowConfig })
  return { ctx, warns }
}

describe('review row config shadowing (S2.2, v37 P2-24)', () => {
  it('a row-level reviewMode/reviewMemoryInterval/reviewSkillInterval is reported once', async () => {
    const { warns } = await load({ reviewMode: 'subagent', memoryInterval: 5, skillInterval: 7 }, 'inject')
    const shadowWarns = warns.filter(line => line.includes(SHADOW_MARK))
    expect(shadowWarns).toHaveLength(1)
    // G1: the report names the CANONICAL registry ids (the ids a deployment writes),
    // whether the row spelled them or their deprecated aliases.
    expect(shadowWarns[0]).toContain('reviewMode')
    expect(shadowWarns[0]).toContain('reviewMemoryInterval')
    expect(shadowWarns[0]).toContain('reviewSkillInterval')
    expect(shadowWarns[0]).toContain('evolution-policy row')
  })

  // G1 §8.4-A: a key the USER set now wins over the policy, so listing it here would
  // tell the user their effective choice has no effect.
  it('G1: a key the user set is left out of the shadow report', async () => {
    const { warns } = await load({ reviewMode: 'subagent', memoryInterval: 5 }, 'inject', { reviewMode: 'subagent' })
    const shadowWarns = warns.filter(line => line.includes(SHADOW_MARK))
    expect(shadowWarns).toHaveLength(1)
    expect(shadowWarns[0]).not.toContain('reviewMode')
    expect(shadowWarns[0]).toContain('reviewMemoryInterval')
  })

  // G1: a volatile field always resolves (its schema default is filled in), so the
  // "did the row set this" test compares against that default — the row that sets
  // nothing must stay silent, which is the whole point of the disclosure.
  it('G1: a volatile field left at its default is not reported', async () => {
    const { warns } = await load({}, 'inject')
    expect(warns.filter(line => line.includes(SHADOW_MARK))).toHaveLength(0)
  })

  it('no row-level value means no shadow warning', async () => {
    const { warns } = await load({}, 'inject')
    expect(warns.filter(line => line.includes(SHADOW_MARK))).toHaveLength(0)
  })

  it('without the policy service the row values are effective and stay silent', async () => {
    const { warns } = await load({ reviewMode: 'subagent', memoryInterval: 5, skillInterval: 7 })
    expect(warns.filter(line => line.includes(SHADOW_MARK))).toHaveLength(0)
  })
})

describe('inject channel ledger disclosure (S2.2, v37 P1-1c)', () => {
  it('the default channel warns once that no plan ledger is produced', async () => {
    const { warns } = await load({})
    const ledgerWarns = warns.filter(line => line.includes(LEDGER_MARK))
    expect(ledgerWarns).toHaveLength(1)
    expect(ledgerWarns[0]).toContain('evolution-activity')
    expect(ledgerWarns[0]).toContain('reviewMode: "subagent"')
  })

  it('an explicit subagent channel produces the ledger and stays silent', async () => {
    const { warns } = await load({}, 'subagent')
    expect(warns.filter(line => line.includes(LEDGER_MARK))).toHaveLength(0)
  })

  it('the disclosure is per LOAD, not per review boundary', async () => {
    const { ctx, warns } = await load({ memoryInterval: 1, skillInterval: 1 })
    // G4: the review's turn window comes from the family's session projection.
    const session = projectable({
      id: SessionId('s22-ledger-warn-session'),
      seq: 1,
      header: { origin: undefined },
      snapshotEvents: () => [{ type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{}' } }],
      deriveMessages: () => [],
    }) as unknown as Session
    await ctx.agents.register({ id: session.id, session, inject: () => {} } as unknown as Agent)
    for (const turn of [1, 2, 3]) {
      emitSessionEvent(ctx, session, 'turn/end', { turn, reason: { kind: 'completed' } })
    }
    expect(warns.filter(line => line.includes(LEDGER_MARK))).toHaveLength(1)
  })
})
