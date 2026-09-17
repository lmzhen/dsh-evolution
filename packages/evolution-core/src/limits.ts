/**
 * Skill content limits: the byte/char budgets every write path validates against.
 *
 * Split out of skill-store.ts (S2-1) so the frontmatter validators and the
 * store share one declaration site. Re-exported by skill-store.ts: the package
 * export surface is unchanged.
 */

import { MAX_DESCRIPTION_LENGTH, MAX_SKILL_CONTENT_CHARS, MAX_SKILL_FILE_BYTES, MAX_SKILL_NAME_LENGTH } from './constants.ts'

/** How a restructure treats a section carrying support-file citations (design §2.2). */
export type CitationPolicy = 'verify' | 'refuse'

/** `verify` checks that every cited target exists and otherwise allows the move;
 * `refuse` restores the pre-0.5 behaviour of refusing ANY citation-carrying
 * section. Resolved at the call site, so every existing limits object keeps
 * working (unknown policy never silently changes a write path). */
export const DEFAULT_CITATION_POLICY: CitationPolicy = 'verify'

/** How a consolidation treats the source's support files (design §16.7).
 * `off` refuses as before; `plan` keeps refusing but reports what a re-home
 * would have to rewrite; `apply` (V2) performs the re-home and the rewrites, but
 * only when the plan proves it leaves NOTHING dangling — otherwise it refuses
 * exactly like `plan`. */
export type ReferenceRewritePolicy = 'off' | 'plan' | 'apply'

/** Default: report the plan on refusal, never write (behaviour unchanged). */
export const DEFAULT_REFERENCE_REWRITE_POLICY: ReferenceRewritePolicy = 'plan'

/** What happens to `.archive` entries past the retention window (design §16.6-④).
 * `report` (the default) names them and deletes nothing; `prune` restores the
 * pre-0.5 deletion, which upstream never does. */
export type ArchiveRetentionPolicy = 'report' | 'prune'

/** Default: report-only, because upstream's hard invariant is never to delete. */
export const DEFAULT_ARCHIVE_RETENTION_POLICY: ArchiveRetentionPolicy = 'report'

export interface SkillLimits {
  maxNameLength: number
  maxDescriptionLength: number
  maxSkillContentChars: number
  maxSkillFileBytes: number
  /** See CitationPolicy. Optional so existing limits objects stay valid. */
  citationPolicy?: CitationPolicy | undefined
  /** See ReferenceRewritePolicy; absent means the default (`plan`). */
  referenceRewrite?: ReferenceRewritePolicy | undefined
  /** See ArchiveRetentionPolicy; absent means the default (`report`). */
  archiveRetention?: ArchiveRetentionPolicy | undefined
}

export const DEFAULT_SKILL_LIMITS: SkillLimits = {
  maxNameLength: MAX_SKILL_NAME_LENGTH,
  maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
  maxSkillContentChars: MAX_SKILL_CONTENT_CHARS,
  maxSkillFileBytes: MAX_SKILL_FILE_BYTES,
}
