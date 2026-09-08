import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'

/**
 * P2-10 rank-contract guard.
 *
 * The plugin's `EVOLUTION_SKILL_RANK = 390` is a deliberate shadow of the
 * upstream `skill-filesystem` provider (`USER_DSH_RANK = 400`): the registry
 * resolves duplicate skill names by "lower rank wins within a layer". Both
 * constants are private to their packages, so an upstream change flips the
 * shadow SILENTLY — this test pins the registry-side resolution contract
 * (390 < 400 ⇒ the low-rank provider wins) so a behavior change surfaces as a
 * failing test rather than a quiet degradation. Re-verify USER_DSH_RANK on
 * every upstream bump (see the constant comment in src/index.ts).
 */
describe('P2-10: skill rank contract', () => {
  it('a lower-rank provider wins a duplicate skill name (390 shadows 400)', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)

    const make = (providerName: string, rank: number): SkillProvider => ({
      name: providerName,
      async list(): Promise<SkillCandidate[]> {
        return [{
          name: 'shadow-skill',
          description: `authored by ${providerName}`,
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'user-dsh',
          provider: providerName,
          rank,
          locator: { name: 'shadow-skill' },
        }]
      },
      async get(): Promise<SkillDefinition> {
        return {
          name: 'shadow-skill',
          description: `authored by ${providerName}`,
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'user-dsh',
          provider: providerName,
          content: `# shadow-skill (${providerName})`,
        }
      },
    })

    // Registration order is the REVERSE of the expected winner: the higher
    // rank (the upstream shadow position, 400) registers FIRST, so a win by
    // registration order would produce the opposite outcome of a win by rank.
    ctx.skills.registerProvider(() => make('upstream-rank-400', 400))
    ctx.skills.registerProvider(() => make('evolution-rank-390', 390))

    const winner = await ctx.skills.get('shadow-skill')
    expect(winner?.provider).toBe('evolution-rank-390')
    expect(winner?.description).toBe('authored by evolution-rank-390')
  })
})
