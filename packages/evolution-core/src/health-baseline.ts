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
