import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionPolicy from '../src/index.ts'
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
})
