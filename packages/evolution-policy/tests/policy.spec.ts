import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionPolicy from '../src/index.ts'
import { DEFAULT_REVIEW_MEMORY_INTERVAL, DEFAULT_REVIEW_SKILL_INTERVAL, DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS, DEFAULT_SUBSTANTIVE_MIN_USER_CHARS, DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS, DEFAULT_MAX_OPS_PER_PLAN, DEFAULT_CURATOR_INTERVAL_HOURS, DEFAULT_STALE_AFTER_DAYS, DEFAULT_ARCHIVE_AFTER_DAYS, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_USER_CHAR_LIMIT, DEFAULT_SKILL_CONTENT_CHARS } from '@deepseek-ai/dsh-evolution-core'

describe('evolution-policy', () => {
  it('is immutable to model-shaped mutation fields and protects policy paths', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPolicy, { protectedPaths: ['/tmp/evo-policy'] })
    expect(ctx.evolutionPolicy.get().memoryChars).toBe(2200)
    expect(ctx.evolutionPolicy.isProtectedPath('/tmp/evo-policy/x.json')).toBe(true)
    expect(ctx.evolutionPolicy.guardReason('memory', { action: 'add', policy: 'x' })).toContain('policy')
    expect(ctx.evolutionPolicy.guardReason('write', { path: '/tmp/evo-policy/x.json' })).toContain('protected')
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
