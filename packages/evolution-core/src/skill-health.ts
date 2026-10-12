/**
 * Skill structure-health domain (rc.73 A1, 008 design): a SECOND assessment
 * dimension beside the six-factor usage quality — document hygiene, consumed
 * by the curator health view and the `/evolution skills health` command.
 *
 * PURE and DERIVED: nothing is persisted; every assessment is computed from
 * file facts at read time. The judgment split follows the original's
 * boundary/治理 layering — deterministic signals here, refinement proposals
 * stay in the review/curator judgment layer. Never become a 7th factor of
 * `computeQualityScores` (different dimension, different consumers).
 */

import { AUTHORING_SPLIT_LINE_CHARS, UPSTREAM_LIMIT_CHARS_PER_TOKEN } from './constants.ts'
import { bodyCost, tokenLineFor } from './cost.ts'
import { type LintFinding, lintSkill } from './skill-lint.ts'

export interface SkillHealthThresholds {
  /** Soft body limit: a body of `softBodyChars` or MORE -> 'warn'; >= 2x ->
   * 'needs-restructure'. V6-34 (0.3.37): the doc comment used to claim
   * "at/below stay healthy" while the engine warns at `>=` — fixed to the
   * implementation edge (the reason copy said "above"). */
  softBodyChars: number
  /** Stamp-density ceiling per KB of body text: rc.NN / commit shas / ISO
   * dates per KB at/above this -> 'warn' (log-like content living in the
   * body — the "invalid info" indicator). */
  stampDensityPerKb: number
  /** Patch count at/above this with zero reads -> 'warn' (write-ghost: the
   * skill is churned but nothing ever loads it). */
  churnMinPatches: number
}

export const DEFAULT_HEALTH_THRESHOLDS: SkillHealthThresholds = {
  // V6: the number is the UPSTREAM line itself (20k characters — "if you're
  // pushing past 20k, split into references/*.md"). The previous 40k was twice
  // that line, which is why a body could sit at 2x the authoring discipline and
  // still read as merely "warn". The JUDGMENT happens in tokens (see
  // assessStructureHealth): the line is converted per body composition, so the
  // textual trigger stays exactly "20k characters" while every reported number is
  // a token count.
  softBodyChars: AUTHORING_SPLIT_LINE_CHARS,
  stampDensityPerKb: 2,
  churnMinPatches: 20,
}

/**
 * Stamp regex shared by health assessment and the maintenance probe (single
 * source, 011). Two refinements over the naive form (F-320): the hex branch
 * requires at least one digit so coincidental all-letter English words
 * (`defaced`, `feedback`) are not counted as commit shas; the ISO branch
 * accepts a UTC `Z`, a numeric UTC offset (`+08:00`), or no timezone at all —
 * non-UTC timestamps used to escape detection (log-like content missed).
 *
 * Known boundary, recorded not fixed (C-22, v10 audit): the hex branch also
 * matches 7-40 char PURE-DIGIT strings (order numbers etc.), so stamp density
 * can be over-reported for such content. The misjudgment direction is "extra
 * stamp hits" only — never a miss — and no real incident exists; revisit only
 * if curator decisions are actually distorted (v10 deferral ledger).
 */
export const HEALTH_STAMP_RE = new RegExp(
  String.raw`\brc\.\d+\b|\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[0-9][0-9a-f]*\b|\b\d{4}-\d{2}-\d{2}(?:T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b`,
  'g',
)

/**
 * Bodies below this size skip stamp-density assessment: a few dates or shas
 * in a short body are ordinary documentation, not log-like content. With the
 * 1KB density floor a 3-date sentence in a small skill measured 3.0/KB and
 * warned on a perfectly healthy body (audit 2026-08-31 X1).
 */
export const MIN_STAMP_BODY_CHARS = 2_000

export type SkillHealthVerdict = 'healthy' | 'warn' | 'needs-restructure'

/** Facts a caller already has; assessors never do IO.
 *
 * `bodyChars`/`bodyText` are the WHOLE `SKILL.md` text as read from disk
 * (frontmatter included), matching both callers: `SkillLibrary.assessHealth`
 * and `snapshotFromLibrary` feed `read()` verbatim. The field names predate
 * that convention; the thresholds are calibrated against the whole file, so a
 * caller must not strip frontmatter before measuring. */
interface SkillHealthSnapshot {
  skillName: string
  bodyChars: number
  bodyText?: string | undefined
  /** Number of non-empty support groups (references/ templates/ scripts/). */
  supportGroups: number
  /** Support FILES under references/ (contract §4), when the caller counted them; null = not measured. */
  supportFiles?: number | undefined
  /** Usage-side patch count, when the caller has it (A2 churn dimension). */
  patchCount?: number | undefined
  /** Usage-side view count, when the caller has it (A2 churn dimension). */
  readCount?: number | undefined
}

interface SkillHealthDim {
  bodyChars: number
  /** The same body on the token scale (limit basis) — the judged quantity. */
  bodyTokens: number
  stampDensityPerKb: number | null
  supportGroups: number
  /** Support FILES under references/; null = the caller could not count them (never 0-as-unknown). */
  supportFiles: number | null
  /** Usage churn facts; null when the caller supplied no counts. */
  churnPatches: number | null
  churnReads: number | null
}

export interface SkillHealthAssessment {
  verdict: SkillHealthVerdict
  dims: SkillHealthDim
  /** The same judgement as `reasons`, in diffable form: (rule id, severity, count). G1. */
  findings: LintFinding[]
}

export function assessStructureHealth(
  snapshot: SkillHealthSnapshot,
  thresholds: SkillHealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): SkillHealthAssessment {
  const dims: SkillHealthDim = {
    bodyChars: snapshot.bodyChars,
    bodyTokens: Math.round(snapshot.bodyChars / UPSTREAM_LIMIT_CHARS_PER_TOKEN),
    stampDensityPerKb: null,
    supportGroups: snapshot.supportGroups,
    supportFiles: snapshot.supportFiles ?? null,
    churnPatches: null,
    churnReads: null,
  }
  // V6: the JUDGMENT runs on the token scale. The configured number stays the
  // borrowed UPSTREAM character line, converted per body composition, so the
  // textual trigger is unchanged while every reported number is a token count.
  // Without body text the token scale is unavailable — the character line then
  // decides, because an absent measurement must never read as a pass.
  const text = snapshot.bodyText
  const hasText = typeof text === 'string' && text.length > 0
  const cost = hasText ? bodyCost(text) : null
  const lineTokens = cost === null ? null : tokenLineFor(thresholds.softBodyChars, cost)
  dims.bodyTokens = cost === null
    // No text: no composition to weigh, so the LIMIT basis is the only honest
    // conversion — the estimate range would need a CJK/ASCII split we do not have.
    ? Math.round(snapshot.bodyChars / UPSTREAM_LIMIT_CHARS_PER_TOKEN)
    : cost.tokens
  const overLine = cost === null || lineTokens === null
    ? snapshot.bodyChars >= thresholds.softBodyChars
    : cost.tokens >= lineTokens
  const overTwice = cost === null || lineTokens === null
    ? snapshot.bodyChars >= thresholds.softBodyChars * 2
    : cost.tokens >= lineTokens * 2
  // G2 ③: the over-line judgement is now expressed as `findings` (see the RULES table in skill-lint);
  // the free-text copy that used to live here is gone, and `overLine`/`overTwice` feed the facts above.
  if (snapshot.bodyText && snapshot.bodyChars >= MIN_STAMP_BODY_CHARS) {
    const kb = Math.max(1, snapshot.bodyChars / 1024)
    const stamps = (snapshot.bodyText.match(HEALTH_STAMP_RE) ?? []).length
    dims.stampDensityPerKb = stamps / kb
  }
  if (snapshot.patchCount !== undefined && snapshot.readCount !== undefined) {
    dims.churnPatches = snapshot.patchCount
    dims.churnReads = snapshot.readCount
  }
  // G1/§3b: the FORM of the judgement. `skill-lint` owns no thresholds — it re-expresses what this
  // engine already decided (token-scale line, /1024 stamp density, soft/2 support threshold).
  const findings = lintSkill({
    skillName: snapshot.skillName,
    dims,
    softLineChars: thresholds.softBodyChars,
    overSoftLine: overLine,
    overTwiceSoftLine: overTwice,
    stampLimitPerKb: thresholds.stampDensityPerKb,
    churnMinPatches: thresholds.churnMinPatches,
    // This engine's snapshot always carries a MEASURED body (its type has no null arm yet); the
    // unreadable case becomes expressible when the caller's type does, and the rule already waits.
    readable: true,
  })
  // G2 ③: the verdict now reads the FINDINGS (equivalent to the reason list by construction — the
  // churn threshold above was aligned for exactly this switch, and the old tests staying green is
  // the equivalence proof).
  const verdict: SkillHealthVerdict = findings.some(f => f.rule === 'body-oversize-2x')
    ? 'needs-restructure'
    : findings.length > 0 ? 'warn' : 'healthy'
  return {
    verdict,
    dims,
    findings,
  }
}
