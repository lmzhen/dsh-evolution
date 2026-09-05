import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/index.ts'
import * as Review from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

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
})
