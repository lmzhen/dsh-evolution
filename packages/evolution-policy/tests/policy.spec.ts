import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionPolicy, { Config } from '../src/index.ts'
import { DEFAULT_REVIEW_MEMORY_INTERVAL, DEFAULT_REVIEW_SKILL_INTERVAL, DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS, DEFAULT_SUBSTANTIVE_MIN_USER_CHARS, DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS, DEFAULT_MAX_OPS_PER_PLAN, DEFAULT_CURATOR_INTERVAL_HOURS, DEFAULT_STALE_AFTER_DAYS, DEFAULT_ARCHIVE_AFTER_DAYS, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_USER_CHAR_LIMIT, DEFAULT_SKILL_CONTENT_CHARS } from '@deepseek-ai/dsh-evolution-core'

describe('evolution-policy', () => {
  it('is immutable to model-shaped mutation fields (P2-11: the ghost policy.json defense is gone)', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPolicy)
    expect(ctx.evolutionPolicy.get().memoryChars).toBe(2200)
    // The real defense: governance keys are refused on the evolution tools.
    expect(ctx.evolutionPolicy.guardReason('memory', { action: 'add', policy: 'x' })).toContain('policy')
    expect(ctx.evolutionPolicy.guardReason('skill_manage', { action: 'create', name: 'a', evolution_config: 1 })).toContain('evolution_config')
    // P2-11: the never-read policy.json path defense is deleted outright.
    expect(ctx.evolutionPolicy.get()).not.toHaveProperty('protectedPaths')
    expect((ctx.evolutionPolicy as unknown as Record<string, unknown>).isProtectedPath).toBeUndefined()
  })

  it('refuses governance keys inside memory operations[] too (E-28, 0.3.17)', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPolicy)
    // Top-level clean; the forbidden key sits in an atomic-batch operation.
    const top = ctx.evolutionPolicy.guardReason('memory', { operations: [{ action: 'add', facts: 'x' }] })
    expect(top).toBeUndefined()
    const inner = ctx.evolutionPolicy.guardReason('memory', { operations: [{ action: 'add', facts: 'x', threshold: 1 }] })
    expect(inner).toContain('threshold')
  })

  it('keeps snapshot defaults in sync with the shared core constants', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPolicy)
    const s = ctx.evolutionPolicy.get()
    expect(s.reviewMemoryInterval).toBe(DEFAULT_REVIEW_MEMORY_INTERVAL)
    expect(s.reviewSkillInterval).toBe(DEFAULT_REVIEW_SKILL_INTERVAL)
    expect(s.substantiveMinToolCalls).toBe(DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS)
    expect(s.substantiveMinUserChars).toBe(DEFAULT_SUBSTANTIVE_MIN_USER_CHARS)
    expect(s.substantiveMinAgentChars).toBe(DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS)
    expect(s.maxOpsPerPlan).toBe(DEFAULT_MAX_OPS_PER_PLAN)
    expect(s.curatorIntervalHours).toBe(DEFAULT_CURATOR_INTERVAL_HOURS)
    expect(s.staleAfterDays).toBe(DEFAULT_STALE_AFTER_DAYS)
    expect(s.archiveAfterDays).toBe(DEFAULT_ARCHIVE_AFTER_DAYS)
    expect(s.memoryChars).toBe(DEFAULT_MEMORY_CHAR_LIMIT)
    expect(s.userChars).toBe(DEFAULT_USER_CHAR_LIMIT)
    expect(s.skillContentChars).toBe(DEFAULT_SKILL_CONTENT_CHARS)
  })

  it('clamps every invalid numeric config value to its default (G3.1 matrix: 0/neg/NaN/Inf → default)', () => {
    type NumericField = 'reviewMemoryInterval' | 'reviewSkillInterval' | 'substantiveMinToolCalls'
      | 'substantiveMinUserChars' | 'substantiveMinAgentChars' | 'memoryChars' | 'userChars'
      | 'skillContentChars' | 'maxOpsPerPlan' | 'curatorIntervalHours' | 'staleAfterDays' | 'archiveAfterDays'
    const defaults: Array<[NumericField, number]> = [
      ['reviewMemoryInterval', DEFAULT_REVIEW_MEMORY_INTERVAL],
      ['reviewSkillInterval', DEFAULT_REVIEW_SKILL_INTERVAL],
      ['substantiveMinToolCalls', DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS],
      ['substantiveMinUserChars', DEFAULT_SUBSTANTIVE_MIN_USER_CHARS],
      ['substantiveMinAgentChars', DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS],
      ['memoryChars', DEFAULT_MEMORY_CHAR_LIMIT],
      ['userChars', DEFAULT_USER_CHAR_LIMIT],
      ['skillContentChars', DEFAULT_SKILL_CONTENT_CHARS],
      ['maxOpsPerPlan', DEFAULT_MAX_OPS_PER_PLAN],
      ['curatorIntervalHours', DEFAULT_CURATOR_INTERVAL_HOURS],
      ['staleAfterDays', DEFAULT_STALE_AFTER_DAYS],
      ['archiveAfterDays', DEFAULT_ARCHIVE_AFTER_DAYS],
    ]
    // One literal config per bad value, every numeric field set to it — this
    // covers each field × each bad value (0/neg/NaN/±Infinity → default). Direct
    // construction bypasses the schema so the assembly clamp is under test; the
    // schema rejection is asserted separately.
    const badConfig = (value: number): Config => ({
      reviewMemoryInterval: value,
      reviewSkillInterval: value,
      substantiveMinToolCalls: value,
      substantiveMinUserChars: value,
      substantiveMinAgentChars: value,
      memoryChars: value,
      userChars: value,
      skillContentChars: value,
      maxOpsPerPlan: value,
      curatorIntervalHours: value,
      staleAfterDays: value,
      archiveAfterDays: value,
    })
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      const ctx = new Context()
      const policy = new EvolutionPolicy(ctx, badConfig(bad))
      const snapshot = policy.get()
      for (const [field, fallback] of defaults) {
        expect(snapshot[field], `${field} with ${String(bad)}`).toBe(fallback)
      }
    }
  })

  it('preserves an in-range numeric config value (G3.1 matrix: reasonable value retained)', () => {
    const ctx = new Context()
    const policy = new EvolutionPolicy(ctx, {
      reviewMemoryInterval: 100,
      reviewSkillInterval: 100,
      substantiveMinToolCalls: 10,
      substantiveMinUserChars: 100,
      substantiveMinAgentChars: 100,
      memoryChars: 3000,
      userChars: 2000,
      skillContentChars: 2000,
      maxOpsPerPlan: 10,
      curatorIntervalHours: 200,
      staleAfterDays: 40,
      archiveAfterDays: 120,
    })
    const s = policy.get()
    expect(s.reviewMemoryInterval).toBe(100)
    expect(s.reviewSkillInterval).toBe(100)
    expect(s.substantiveMinToolCalls).toBe(10)
    expect(s.substantiveMinUserChars).toBe(100)
    expect(s.substantiveMinAgentChars).toBe(100)
    expect(s.memoryChars).toBe(3000)
    expect(s.userChars).toBe(2000)
    expect(s.skillContentChars).toBe(2000)
    expect(s.maxOpsPerPlan).toBe(10)
    expect(s.curatorIntervalHours).toBe(200)
    expect(s.staleAfterDays).toBe(40)
    expect(s.archiveAfterDays).toBe(120)
  })

  it('rejects 0/negative at the schema level but lets NaN/Infinity through (G3.1 .min(1))', () => {
    const parse = (input: unknown): unknown => (Config as unknown as (i: unknown) => unknown)(input)
    expect(() => parse({ reviewMemoryInterval: 0 })).toThrow()
    expect(() => parse({ maxOpsPerPlan: -1 })).toThrow()
    // NaN and +Infinity are NOT rejected by `z.number().min(1)` — they
    // penetrate the schema and are caught by the assembly-time clamp instead.
    const nanResult = parse({ reviewMemoryInterval: NaN }) as { reviewMemoryInterval: number }
    expect(Number.isNaN(nanResult.reviewMemoryInterval)).toBe(true)
    const infResult = parse({ reviewMemoryInterval: Infinity }) as { reviewMemoryInterval: number }
    expect(infResult.reviewMemoryInterval).toBe(Infinity)
  })
})
