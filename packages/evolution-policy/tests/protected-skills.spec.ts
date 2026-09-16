import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionPolicy from '../src/index.ts'
import { PROTECTED_BUILTIN_SKILLS } from '@deepseek-ai/dsh-evolution-core'

// PLAN S4.2 (2026-09-16): the snapshot's protected face must be DERIVED from
// the core PROTECTED_BUILTIN_SKILLS single source. A plain content assertion
// cannot tell the constant apart from a re-introduced 'plan' literal (the two
// coincide today), so this file mocks the core export with a SENTINEL set: the
// sentinel may only reach the snapshot through the core constant — a hardcoded
// literal goes red here. Mocking one export keeps every other core export
// (defaults, clampedNumber) at its actual implementation.
const { sentinelSkills } = vi.hoisted(() => ({ sentinelSkills: ['core-sentinel-skill'] }))

vi.mock('@deepseek-ai/dsh-evolution-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-evolution-core')>()
  return {
    ...actual,
    PROTECTED_BUILTIN_SKILLS: new Set<string>(sentinelSkills),
  }
})

describe('evolution-policy protected face single-sourcing (PLAN S4.2, 2026-09-16)', () => {
  it('the default protected face flows from the mocked PROTECTED_BUILTIN_SKILLS, not a hardcoded literal', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPolicy)
    expect([...PROTECTED_BUILTIN_SKILLS]).toEqual(sentinelSkills) // the mock is armed
    expect([...ctx.evolutionPolicy.get().protectedSkillNames]).toEqual(sentinelSkills)
  })

  it('configured protectedSkillNames still merge (extend + dedupe) on top of the core face', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionPolicy, { protectedSkillNames: ['house-skill', 'core-sentinel-skill', 'house-skill'] })
    expect([...ctx.evolutionPolicy.get().protectedSkillNames]).toEqual([...sentinelSkills, 'house-skill'])
  })
})
