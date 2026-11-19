/**
 * The skills implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type { SkillsPort } from '@deepseek-ai/dsh-evolution-contract'

export type { SkillsPort } from '@deepseek-ai/dsh-evolution-contract'

interface SkillsServiceLike {
  list(options?: { scope?: unknown }): Promise<readonly SkillSummary[]>
}

/** Resolve the skills port; undefined means the host has no skills service. */
export function skillsPort(ctx: Context): SkillsPort | undefined {
  // platform-declaration anchor: skills is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('skills') as SkillsServiceLike | undefined
  if (service === undefined || typeof service.list !== 'function') return undefined
  return { list: (options) => service.list(options) }
}
