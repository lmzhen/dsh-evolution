/**
 * The skills-catalog half of the family's platform contract.
 *
 * Reads stay scope-aware: the caller passes the calling scope (or undefined for
 * the explicit global layer), exactly as the platform's skill registry expects.
 */
import type { SkillSummary } from '@deepseek-ai/dsh-skill'

export interface SkillsPort {
  list(options?: { scope?: unknown }): Promise<readonly SkillSummary[]>
}
