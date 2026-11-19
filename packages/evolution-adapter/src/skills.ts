/**
 * The skills-catalog half of the family's host platform boundary.
 *
 * Reads stay scope-aware: the caller passes the calling scope (or undefined for
 * the explicit global layer), exactly as the platform's skill registry expects.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'

export interface SkillsPort {
  list(options?: { scope?: unknown }): Promise<readonly SkillSummary[]>
}

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
