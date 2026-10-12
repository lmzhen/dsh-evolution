/*
 * health-baseline — calibration and rule ADMISSION, as pure functions (G1, contract §4).
 *
 * A rule may only enter the engine when it is worth its noise, and that is a fact about two corpora,
 * not an opinion: the platform's own skills must not trip it at all (a rule the shipped library
 * already violates is a rule nobody can satisfy), and on the user's library it must bite often
 * enough to matter but not so often that it is furniture. This module holds the counting and the
 * verdict; walking the corpora and writing the artifact stay in the caller.
 *
 * Pure: no IO. `values` is keyed by rule id so a diff between two baselines is a map diff.
 */
import { type LintFacts, lintSkill, RULES } from './skill-lint.ts'

export type Corpus = 'user' | 'platform'

export interface CorpusSkill {
  name: string
  corpus: Corpus
  facts: LintFacts
}

export interface RuleAdmission {
  platformHits: number
  userHits: number
  userHitRate: number
}

export interface HealthBaseline {
  /** Frozen unit and scope: a rate is only comparable when both are named (contract §4). */
  unit: 'chars'
  scope: 'references markdown file count'
  corpora: { user: number; platform: number }
  values: Record<string, RuleAdmission>
}

export interface AdmissionThresholds {
  /** A user-library hit rate below this is too rare to be worth a rule. */
  minUserHitRate: number
  /** …and above this it is furniture (every skill trips it, so it carries no signal). */
  maxUserHitRate: number
}

export const DEFAULT_ADMISSION: AdmissionThresholds = { minUserHitRate: 0.05, maxUserHitRate: 0.25 }

export function buildHealthBaseline(skills: readonly CorpusSkill[]): HealthBaseline {
  const values: Record<string, RuleAdmission> = {}
  for (const rule of RULES) values[rule.id] = { platformHits: 0, userHits: 0, userHitRate: 0 }
  let user = 0
  let platform = 0
  for (const skill of skills) {
    if (skill.corpus === 'user') user += 1
    else platform += 1
    for (const finding of lintSkill(skill.facts)) {
      const row = values[finding.rule]
      if (row === undefined) continue
      if (skill.corpus === 'user') row.userHits += 1
      else row.platformHits += 1
    }
  }
  for (const row of Object.values(values)) row.userHitRate = user === 0 ? 0 : row.userHits / user
  return {
    unit: 'chars',
    scope: 'references markdown file count',
    corpora: { user, platform },
    values,
  }
}

/** The admission verdict for ONE rule id (contract §4): platform corpus must not trip it, and the
 * user-library hit rate must land inside the band. Every failure names the number it failed on. */
export function admissionVerdict(
  baseline: HealthBaseline,
  ruleId: string,
  thresholds: AdmissionThresholds = DEFAULT_ADMISSION,
): { admitted: boolean; failures: string[] } {
  const row = baseline.values[ruleId]
  const failures: string[] = []
  if (row === undefined) return { admitted: false, failures: ['rule ' + ruleId + ' has no baseline row'] }
  if (baseline.corpora.platform === 0) failures.push('no platform-corpus skills measured — a vacuous 0-hit count admits any rule')
  else if (row.platformHits !== 0) failures.push('platform corpus trips ' + ruleId + ' ' + String(row.platformHits) + ' time(s) — a rule the shipped library violates is unsatisfiable')
  if (baseline.corpora.user === 0) failures.push('no user-library skills measured — a rate over an empty corpus proves nothing')
  else if (row.userHitRate < thresholds.minUserHitRate) failures.push(ruleId + ' hits ' + row.userHitRate.toFixed(3) + ' of the user library, below ' + String(thresholds.minUserHitRate) + ' — too rare to be worth a rule')
  else if (row.userHitRate > thresholds.maxUserHitRate) failures.push(ruleId + ' hits ' + row.userHitRate.toFixed(3) + ' of the user library, above ' + String(thresholds.maxUserHitRate) + ' — furniture, no signal')
  return { admitted: failures.length === 0, failures }
}
