// @tier fast
/**
 * The family authority must NOT become a hard injection.
 *
 * `evolution-authority` publishes `evolutionMutationAuthority` only after
 * `await ctx.evolutionIo.whenReady()`, and an agent-plane-only composition mounts this row with no
 * authority at all. A name in `inject` is a REQUIRED dependency — cordis `Fiber._refresh()` keeps the
 * epoch INACTIVE while any injected service is missing — so declaring it would silently drop
 * `skill_manage` from those compositions (the installation matrix asserts it must stay). The fenced
 * write lock is therefore resolved per write by `newSkillLibrary`'s resolver, covered by
 * `evolution-core/tests/skill-store-authority-lock.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { inject } from '../src/index.ts'

describe('tool-skill-manage injections', () => {
  it('does not require the family authority: the row must mount without it', () => {
    expect(inject).not.toContain('evolutionMutationAuthority')
  })

  it('still declares the services apply() reads directly', () => {
    expect(inject).toEqual(expect.arrayContaining(['tools', 'skillUsage', 'evolutionIo']))
  })
})
