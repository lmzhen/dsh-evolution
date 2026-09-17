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

/** How the 100k-character cap treats SUPPORT files (design §16.6, V4). Upstream
 * applies the cap to every written file; we land it in `report` mode first (the
 * write goes through with an advisory) and `enforce` refuses — with the same
 * net-shrink repair path SKILL.md already has, so an over-cap legacy file can
 * always be brought back under the cap instead of becoming unmaintainable. */
export type SupportFileCharPolicy = 'report' | 'enforce'

/** Default: report, so the cap cannot brick an existing oversize file on upgrade
 * (the live library carries a 189k-character release log today). */
export const DEFAULT_SUPPORT_FILE_CHAR_POLICY: SupportFileCharPolicy = 'report'

/** The four stage defaults in ONE object, so the policy schema's `z.default(...)`
 * calls and the store's fallbacks cannot drift apart. */
export const POLICY_STAGE_DEFAULTS = Object.freeze({
  citationPolicy: DEFAULT_CITATION_POLICY,
  referenceRewrite: DEFAULT_REFERENCE_REWRITE_POLICY,
  archiveRetention: DEFAULT_ARCHIVE_RETENTION_POLICY,
  supportFileCharPolicy: DEFAULT_SUPPORT_FILE_CHAR_POLICY,
})

/** The policy-snapshot fields that select a write-behaviour STAGE (design §16).
 * Structural, not imported from evolution-policy, so core stays a leaf. */
export interface PolicyStageFields {
  citationPolicy?: CitationPolicy | undefined
  referenceRewrite?: ReferenceRewritePolicy | undefined
  archiveRetention?: ArchiveRetentionPolicy | undefined
  supportFileCharPolicy?: SupportFileCharPolicy | undefined
}

/**
 * The ONE conversion from the deployment policy snapshot to library limits
 * (design §16.7): every plugin that owns a writable SkillLibrary spreads this into
 * its limits, so a stage selected in cordis.yml reaches every write path. A
 * per-plugin copy would be the third home for the same threshold.
 *
 * Only PRESENT fields are copied: an absent policy field must fall through to the
 * library default rather than pinning `undefined` onto an optional limit (which
 * `exactOptionalPropertyTypes` forbids and which would defeat the `?? DEFAULT`
 * resolution inside the store).
 * @param snapshot - the evolutionPolicy snapshot, or undefined when unmounted.
 * @returns the stage fields the snapshot actually carries.
 */
export function policyStageLimits(snapshot: PolicyStageFields | undefined): PolicyStageFields {
  if (snapshot === undefined) return {}
  const stages: PolicyStageFields = {}
  if (snapshot.citationPolicy !== undefined) stages.citationPolicy = snapshot.citationPolicy
  if (snapshot.referenceRewrite !== undefined) stages.referenceRewrite = snapshot.referenceRewrite
  if (snapshot.archiveRetention !== undefined) stages.archiveRetention = snapshot.archiveRetention
  if (snapshot.supportFileCharPolicy !== undefined) stages.supportFileCharPolicy = snapshot.supportFileCharPolicy
  return stages
}

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
  /** See SupportFileCharPolicy; absent means the default (`report`). */
  supportFileCharPolicy?: SupportFileCharPolicy | undefined
}

export const DEFAULT_SKILL_LIMITS: SkillLimits = {
  maxNameLength: MAX_SKILL_NAME_LENGTH,
  maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
  maxSkillContentChars: MAX_SKILL_CONTENT_CHARS,
  maxSkillFileBytes: MAX_SKILL_FILE_BYTES,
}
