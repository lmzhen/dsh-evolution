/**
 * Skill content limits: the byte/char budgets every write path validates against.
 *
 * Split out of skill-store.ts (S2-1) so the frontmatter validators and the
 * store share one declaration site. Re-exported by skill-store.ts: the package
 * export surface is unchanged.
 */

import { MAX_DESCRIPTION_LENGTH, MAX_SKILL_CONTENT_CHARS, MAX_SKILL_FILE_BYTES, MAX_SKILL_NAME_LENGTH } from './constants.ts'

export interface SkillLimits {
  maxNameLength: number
  maxDescriptionLength: number
  maxSkillContentChars: number
  maxSkillFileBytes: number
}

export const DEFAULT_SKILL_LIMITS: SkillLimits = {
  maxNameLength: MAX_SKILL_NAME_LENGTH,
  maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
  maxSkillContentChars: MAX_SKILL_CONTENT_CHARS,
  maxSkillFileBytes: MAX_SKILL_FILE_BYTES,
}
