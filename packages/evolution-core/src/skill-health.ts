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

import { DEFAULT_SOFT_BODY_TOKENS, UPSTREAM_LIMIT_CHARS_PER_TOKEN } from './constants.ts'
import { measureText, measureUnit } from './text-metrics.ts'
import { type LintFinding, lintSkill } from './skill-lint.ts'

export interface SkillHealthThresholds {
  /** Fixed soft body budget in tokens: a body at/above it -> 'warn'; 2x ->
   * 'needs-restructure'. This is the judged quantity. */
  softBodyTokens?: number
  /** Deprecated legacy character line. Used only when `softBodyTokens` is absent,
   * converted on the documented UPSTREAM basis; never a per-body token line. */
  softBodyChars?: number
  /** Stamp-density ceiling per KB of body text: rc.NN / commit shas / ISO
   * dates per KB at/above this -> 'warn' (log-like content living in the
   * body — the "invalid info" indicator). */
  stampDensityPerKb: number
  /** Patch count at/above this with zero reads -> 'warn' (write-ghost: the
   * skill is churned but nothing ever loads it). */
  churnMinPatches: number
  /** Hard-cap hits at/above this with a large support closure -> scope-overloaded advisory. */
  hardCapMinHits: number
}

export const DEFAULT_HEALTH_THRESHOLDS: SkillHealthThresholds = {
  // V6: the number was the UPSTREAM 20k-character authoring line. The judgment
  // is now a fixed token budget derived from that line; the character field stays
  // as a deprecated migration input only.
  softBodyTokens: DEFAULT_SOFT_BODY_TOKENS,
  stampDensityPerKb: 2,
  churnMinPatches: 20,
  hardCapMinHits: 3,
}

/** Resolve the judged soft-body token budget, accepting the legacy character line. */
export function softBodyTokenBudget(thresholds: SkillHealthThresholds): number {
  if (thresholds.softBodyTokens !== undefined) return thresholds.softBodyTokens
  if (thresholds.softBodyChars !== undefined) return Math.round(thresholds.softBodyChars / UPSTREAM_LIMIT_CHARS_PER_TOKEN)
  return DEFAULT_SOFT_BODY_TOKENS
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

export type SkillHealthVerdict = 'healthy' | 'warn' | 'needs-restructure' | 'unreadable'

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
  /** Mechanical hard-cap-hit count, when the caller has it; null = unknown. */
  hardCapHits?: number | null | undefined
}

export interface SkillHealthDim {
  bodyChars: number
  /** The same body on the token scale (limit basis) — the judged quantity. */
  bodyTokens: number
  stampDensityPerKb: number | null
  /** Raw stamp hits — the number the stamp rule reports as `count`. */
  stampHits: number | null
  supportGroups: number
  /** Support FILES under references/; null = the caller could not count them (never 0-as-unknown). */
  supportFiles: number | null
  /** Usage churn facts; null when the caller supplied no counts. */
  churnPatches: number | null
  churnReads: number | null
  hardCapHits: number | null
}

export interface SkillHealthAssessment {
  verdict: SkillHealthVerdict
  dims: SkillHealthDim
  /** The same judgement as `reasons`, in diffable form: (rule id, severity, count). G1. */
  findings: LintFinding[]
}

/** One finding as the health route/panel sees it (wire shape, not the engine's LintFinding). */
export interface SkillHealthWireFinding {
  rule: string
  count: number
  line: string | null
  countIsMeaningful: boolean
  severity?: 'warn' | 'error'
  message?: string
}

/** Measured dimensions on the health wire; absent when the scan could not read them. */
export interface SkillHealthWireDims {
  bodyChars: number | null
  bodyTokens: number | null
  supportGroups: number
  supportFiles: number | null
  churnPatches: number | null
  churnReads: number | null
  stampDensityPerKb: number | null
}

/** One health row on the wire; `readable: false` is its own verdict, never healthy. */
export interface SkillHealthWireRow {
  name: string
  verdict: 'healthy' | 'warn' | 'error' | 'unreadable' | 'needs-restructure'
  findings: SkillHealthWireFinding[]
  dims?: SkillHealthWireDims | null
  protection?: string | null
  hardCapHits?: number | null
}

/**
 * The findings for ONE body, computed by the engine that owns the judgement (G4).
 *
 * Deliberately a thin call into `assessStructureHealth`: a later consumer (the write receipt) needs
 * findings for a body it is about to store, and re-deriving the facts anywhere else would be a
 * SECOND judgement — the token-scale line, the /1024 stamp density and the soft/2 support threshold
 * all live in one place and must stay there.
 * @param skillName - the skill the body belongs to (used in messages).
 * @param content - the WHOLE SKILL.md text, frontmatter included (the engine's own convention).
 * @param supportGroups - non-empty support dirs; pass the real count, never a guess.
 * @param thresholds - the configured thresholds; defaults to the shipped ones.
 * @returns the findings, in rule order.
 */
export function lintBody(
  skillName: string,
  content: string,
  supportGroups: number,
  thresholds: SkillHealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): LintFinding[] {
  return assessStructureHealth(
    { skillName, bodyChars: content.length, bodyText: content, supportGroups },
    thresholds,
  ).findings
}

export function assessStructureHealth(
  snapshot: SkillHealthSnapshot,
  thresholds: SkillHealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): SkillHealthAssessment {
  const dims: SkillHealthDim = {
    bodyChars: snapshot.bodyChars,
    bodyTokens: Math.round(snapshot.bodyChars / UPSTREAM_LIMIT_CHARS_PER_TOKEN),
    stampDensityPerKb: null,
    stampHits: null,
    supportGroups: snapshot.supportGroups,
    supportFiles: snapshot.supportFiles ?? null,
    churnPatches: null,
    churnReads: null,
    hardCapHits: snapshot.hardCapHits ?? null,
  }
  // V6: the JUDGMENT runs on a FIXED token budget. A legacy character line is
  // converted once on the documented UPSTREAM basis; it is not re-converted per
  // body composition (that would preserve the character edge and defeat the point).
  // Without body text the token scale is unavailable — the character line then
  // decides, because an absent measurement must never read as a pass.
  const text = snapshot.bodyText
  const hasText = typeof text === 'string' && text.length > 0
  const tokenBudget = softBodyTokenBudget(thresholds)
  dims.bodyTokens = hasText
    ? measureText(text).tokens.value
    // No text: no composition to weigh, so the LIMIT basis is the only honest
    // conversion — the estimate range would need a script split we do not have.
    : Math.round(snapshot.bodyChars / UPSTREAM_LIMIT_CHARS_PER_TOKEN)
  const overLine = dims.bodyTokens >= tokenBudget
  const overTwice = dims.bodyTokens >= tokenBudget * 2
  // G2 ③: the over-line judgement is now expressed as `findings` (see the RULES table in skill-lint);
  // the free-text copy that used to live here is gone, and `overLine`/`overTwice` feed the facts above.
  if (snapshot.bodyText && measureUnit(snapshot.bodyText, 'codePoints') >= MIN_STAMP_BODY_CHARS) {
    const kb = Math.max(1, measureUnit(snapshot.bodyText, 'codePoints') / 1024)
    const stamps = (snapshot.bodyText.match(HEALTH_STAMP_RE) ?? []).length
    dims.stampDensityPerKb = stamps / kb
    dims.stampHits = stamps
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
    softLineTokens: tokenBudget,
    overSoftLine: overLine,
    overTwiceSoftLine: overTwice,
    stampLimitPerKb: thresholds.stampDensityPerKb,
    churnMinPatches: thresholds.churnMinPatches,
    hardCapMinHits: thresholds.hardCapMinHits,
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
