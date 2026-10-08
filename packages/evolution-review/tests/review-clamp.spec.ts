import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/index.ts'
import * as Review from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { DEFAULT_REVIEW_MEMORY_INTERVAL } from '@deepseek-ai/dsh-evolution-core'
import { vol } from '../../test-support/volatile-config.ts'

// Every numeric field below clamps to at least 1: a 0 interval would fire a
// review every turn, a 0 timeout means AbortSignal.timeout(0) (aborts
// immediately — NOT a "no timeout" meaning), reviewMaxDepth 0 is the historical
// 0.3.1 spawn-reject defect, and a 0 char/tool-cap disables the whole window.
const FIELDS = ['memoryInterval', 'skillInterval', 'reviewTimeoutMs', 'reviewContextMessages', 'reviewMessageChars', 'reviewMaxDepth', 'skillReviewCompletionMinToolCalls'] as const

describe('evolution-review G3.1 numeric clamping', () => {
  const parse = (input: unknown): unknown => (Config as unknown as (i: unknown) => unknown)(input)

  it('schema rejects 0/negative but lets NaN/Infinity through (.min(1))', () => {
    for (const field of FIELDS) {
      expect(() => parse({ [field]: 0 }), `${field} 0`).toThrow()
      expect(() => parse({ [field]: -1 }), `${field} -1`).toThrow()
    }
    const nan = parse({ memoryInterval: NaN }) as { memoryInterval: number }
    expect(Number.isNaN(nan.memoryInterval)).toBe(true)
    const inf = parse({ reviewMaxDepth: Infinity }) as { reviewMaxDepth: number }
    expect(inf.reviewMaxDepth).toBe(Infinity)
  })

  it('assembly applies a NaN numeric config without crashing (clamped to defaults)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    // NaN passes the schema (the `.min(1)` guard only rejects 0/negative), so
    // the assembly clamp is what corrects it; the plugin must still mount.
    await ctx.plugin(Review, { reviewEnabled: false, memoryInterval: NaN, reviewMaxDepth: NaN, skillReviewCompletionMinToolCalls: NaN })
    expect(ctx.get('agents')).toBeDefined()
  })

  it('V4-44: clampReviewConfig clamps out-of-domain values to the defaults and warns', async () => {
    const ctx = new Context()
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    const clamped = Review.clampReviewConfig({ reviewTimeoutMs: 0, reviewMaxDepth: 0, memoryInterval: NaN }, ctx)
    // reviewTimeoutMs 0 → the 120 000 default (NOT "no timeout": AbortSignal.timeout(0)
    // aborts immediately). reviewMaxDepth 0 → 1 (the 0.3.1 spawn-reject defect).
    expect(clamped.reviewTimeoutMs).toBe(120_000)
    expect(clamped.reviewMaxDepth).toBe(1)
    // G1: the deprecated cadence alias is the live interval key's fallback spelling,
    // so it is clamped by the row resolver (which warns through the same sink shape).
    const warn = (message: string): void => { ctx.logger.warn('dsh-evolution-review: ' + message) }
    const row = Review.resolveReviewRowSettings({ memoryInterval: NaN }, warn)
    expect(row.reviewMemoryInterval).toBe(DEFAULT_REVIEW_MEMORY_INTERVAL)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to the default'))
    warnSpy.mockRestore()
  })


  it('G0/S0.4 + G1: a row spelling the canonical ids resolves exactly like the alias', async () => {
    const ctx = new Context()
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    // G1: the canonical ids are LIVE fields, so the loader hands the plugin a
    // reference (modelled by `vol`) — the resolver reads the canonical key first and
    // falls back to the deprecated alias, resolving both spellings to one number.
    const warn = (message: string): void => { ctx.logger.warn('dsh-evolution-review: ' + message) }
    const canonical = Review.resolveReviewRowSettings({ reviewSkillInterval: vol(30), reviewMemoryInterval: vol(12) }, warn)
    expect(canonical.reviewSkillInterval).toBe(30)
    expect(canonical.reviewMemoryInterval).toBe(12)
    const aliased = Review.resolveReviewRowSettings({ skillInterval: 30, memoryInterval: 12 }, warn)
    expect(aliased.reviewSkillInterval).toBe(30)
    expect(aliased.reviewMemoryInterval).toBe(12)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('falling back to the default'))
    warnSpy.mockRestore()
  })

  it('V4-44: AbortSignal.timeout(0) aborts immediately — the semantic that forces the 0 clamp', async () => {
    // A 0 reviewTimeoutMs is NOT "no timeout"; it is an immediate abort. This
    // behavior-level assertion documents why the clamp to at least 1 exists.
    const controller = AbortSignal.timeout(0)
    await new Promise<void>((resolve) => {
      controller.addEventListener('abort', () => { resolve() }, { once: true })
    })
    expect(controller.aborted).toBe(true)
  })
})
