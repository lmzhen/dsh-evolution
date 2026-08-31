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

export interface SkillHealthThresholds {
  /** Soft body limit: body chars at/below stay 'healthy' by size; above ->
   * 'warn'; >= 2x -> 'needs-restructure'. */
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
  softBodyChars: 40_000,
  stampDensityPerKb: 2,
  churnMinPatches: 20,
}

const HEALTH_STAMP_RE = /\brc\.\d+\b|\b[0-9a-f]{7,40}\b|\b\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z)?\b/g

/**
 * Bodies below this size skip stamp-density assessment: a few dates or shas
 * in a short body are ordinary documentation, not log-like content. With the
 * 1KB density floor a 3-date sentence in a small skill measured 3.0/KB and
 * warned on a perfectly healthy body (audit 2026-08-31 X1).
 */
const MIN_STAMP_BODY_CHARS = 2_000

export type SkillHealthVerdict = 'healthy' | 'warn' | 'needs-restructure'

/** Facts a caller already has; assessors never do IO. */
export interface SkillHealthSnapshot {
  skillName: string
  bodyChars: number
  bodyText?: string | undefined
  /** Number of non-empty support groups (references/ templates/ scripts/). */
  supportGroups: number
  /** Usage-side patch count, when the caller has it (A2 churn dimension). */
  patchCount?: number | undefined
  /** Usage-side view count, when the caller has it (A2 churn dimension). */
  readCount?: number | undefined
}

export interface SkillHealthDim {
  bodyChars: number
  stampDensityPerKb: number | null
  supportGroups: number
  /** Usage churn facts; null when the caller supplied no counts. */
  churnPatches: number | null
  churnReads: number | null
}

export interface SkillHealthAssessment {
  verdict: SkillHealthVerdict
  dims: SkillHealthDim
  reasons: string[]
}

export function assessStructureHealth(
  snapshot: SkillHealthSnapshot,
  thresholds: SkillHealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): SkillHealthAssessment {
  const reasons: string[] = []
  const dims: SkillHealthDim = {
    bodyChars: snapshot.bodyChars,
    stampDensityPerKb: null,
    supportGroups: snapshot.supportGroups,
    churnPatches: null,
    churnReads: null,
  }
  const needs = snapshot.bodyChars >= thresholds.softBodyChars * 2
  if (needs) {
    reasons.push(`body ${snapshot.bodyChars} chars is >= 2x the soft limit (${thresholds.softBodyChars}) — consider splitting or offloading`)
  } else if (snapshot.bodyChars >= thresholds.softBodyChars) {
    reasons.push(`body ${snapshot.bodyChars} chars above the soft limit (${thresholds.softBodyChars})`)
  }
  if (snapshot.bodyText && snapshot.bodyChars >= MIN_STAMP_BODY_CHARS) {
    const kb = Math.max(1, snapshot.bodyChars / 1024)
    const stamps = (snapshot.bodyText.match(HEALTH_STAMP_RE) ?? []).length
    dims.stampDensityPerKb = stamps / kb
    if (dims.stampDensityPerKb >= thresholds.stampDensityPerKb) {
      reasons.push(`stamp density ${dims.stampDensityPerKb.toFixed(1)}/KB (rc/sha/date lines — log-like content in the body)`)
    }
  }
  if (snapshot.supportGroups === 0 && snapshot.bodyChars >= thresholds.softBodyChars / 2) {
    reasons.push(`large body (${snapshot.bodyChars} chars) with NO support files — session detail may belong in references/`)
  }
  if (snapshot.patchCount !== undefined && snapshot.readCount !== undefined) {
    dims.churnPatches = snapshot.patchCount
    dims.churnReads = snapshot.readCount
    if (snapshot.patchCount >= thresholds.churnMinPatches && snapshot.readCount === 0) {
      reasons.push(`patched ${snapshot.patchCount} times but never read (write-ghost — content may be dead)`)
    }
  }
  return {
    verdict: needs ? 'needs-restructure' : reasons.length > 0 ? 'warn' : 'healthy',
    dims,
    reasons,
  }
}
