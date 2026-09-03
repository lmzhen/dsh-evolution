/**
 * Maintain-plan validation and normalization (011 §7).
 *
 * Contract checks (mechanical, no semantics): enum membership, required
 * fields, evidence closed over the facts block's signal set, needs_human
 * consistency with the confidence/reversibility/is_override/unknown rules,
 * and the quality_low=unknown global imposition. Never judges whether a
 * recommendation is right — only whether it is well-formed and traceable.
 */

import { findDriftSignal, type DriftReport, type DriftSignal } from '@deepseek-ai/dsh-evolution-core'

export type MaintainVerdict = 'issues' | 'no_issues'
export type MaintainPlanItemKind = 'skill-level' | 'relationship-level' | 'library-level'
export type MaintainReversibility = 'archive' | 'restructure' | 'patch' | 'rename' | 'none'
export type MaintainImpact = 'better' | 'worse' | 'neutral'

export interface MaintainEvidence {
  signal: string
  value: string
}

export interface MaintainPlanItem {
  kind: MaintainPlanItemKind
  names: string[]
  rule: string
  evidence: MaintainEvidence[]
  finding: string
  recommendation: string
  semantic_reasoning: string
  impact: MaintainImpact
  impact_reason: string
  reversibility: MaintainReversibility
  undo_path: string
  confidence: number
  needs_human: boolean
  is_override: boolean
  override_reason?: string | undefined
}

export interface MaintainPlan {
  verdict: MaintainVerdict
  plan: MaintainPlanItem[]
  notes: string[]
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  /** Normalized plan (needs_human impositions applied). */
  plan: MaintainPlan
  /** Skill names whose items were force-marked needs_human by the quality_low gate. */
  forcedHuman: string[]
}

const KINDS: ReadonlySet<string> = new Set(['skill-level', 'relationship-level', 'library-level'])
const REVERSIBILITIES: ReadonlySet<string> = new Set(['archive', 'restructure', 'patch', 'rename', 'none'])
const IMPACTS: ReadonlySet<string> = new Set(['better', 'worse', 'neutral'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback: string): string {
  return isNonEmptyString(value) ? value : fallback
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateEvidence(
  value: unknown,
  validSignals: ReadonlySet<string>,
  errors: string[],
  path: string,
): MaintainEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path}.evidence: must be a non-empty array`)
    return []
  }
  const out: MaintainEvidence[] = []
  const arr: unknown[] = value
  for (const index of arr.keys()) {
    const entry = arr[index]
    if (!isRecord(entry) || !isNonEmptyString(entry.signal) || !isNonEmptyString(entry.value)) {
      errors.push(`${path}.evidence[${index}]: must be {signal, value} strings`)
      continue
    }
    if (!validSignals.has(entry.signal)) {
      errors.push(`${path}.evidence[${index}].signal="${entry.signal}": not in the facts block`)
    }
    out.push({ signal: entry.signal, value: entry.value })
  }
  return out
}

/**
 * Validate and normalize a maintain plan against the facts report.
 * @param raw - subagent output (already JSON-parsed by the subagent channel).
 * @param report - the DriftReport rendered into the facts block (quality_low gate source).
 * @param validSignals - ids present in the rendered facts block.
 */
export function validateAndNormalizeMaintainPlan(
  raw: unknown,
  report: DriftReport,
  validSignals: ReadonlySet<string>,
): ValidationResult {
  const errors: string[] = []
  const forcedHuman: string[] = []

  if (!isRecord(raw)) return { ok: false, errors: ['plan root: must be an object'], plan: { verdict: 'no_issues', plan: [], notes: [] }, forcedHuman }

  const verdict = raw.verdict
  if (verdict !== 'issues' && verdict !== 'no_issues') {
    errors.push(`verdict: must be "issues" or "no_issues", got ${String(verdict)}`)
  }

  const plan: MaintainPlanItem[] = []
  if (!Array.isArray(raw.plan)) {
    errors.push('plan: must be an array')
  } else {
    const rawPlan: unknown[] = raw.plan
    if (verdict === 'no_issues' && rawPlan.length > 0) {
      errors.push('verdict=no_issues with a non-empty plan')
    }
    for (const index of rawPlan.keys()) {
      const item = rawPlan[index]
      const path = `plan[${index}]`
      if (!isRecord(item)) {
        errors.push(`${path}: must be an object`)
        continue
      }
      if (typeof item.kind !== 'string' || !KINDS.has(item.kind)) errors.push(`${path}.kind: invalid`)
      if (!Array.isArray(item.names) || item.names.length === 0 || !item.names.every(isNonEmptyString)) {
        errors.push(`${path}.names: non-empty string array required`)
      }
      if (!isNonEmptyString(item.rule)) errors.push(`${path}.rule: required`)
      if (typeof item.finding !== 'string' || item.finding.trim().length === 0) errors.push(`${path}.finding: required`)
      if (!isNonEmptyString(item.recommendation)) errors.push(`${path}.recommendation: required`)
      if (!isNonEmptyString(item.semantic_reasoning)) errors.push(`${path}.semantic_reasoning: required`)
      if (typeof item.impact !== 'string' || !IMPACTS.has(item.impact)) errors.push(`${path}.impact: invalid`)
      if (!isNonEmptyString(item.impact_reason)) errors.push(`${path}.impact_reason: required`)
      if (typeof item.reversibility !== 'string' || !REVERSIBILITIES.has(item.reversibility)) {
        errors.push(`${path}.reversibility: invalid`)
      }
      if (!isNonEmptyString(item.undo_path)) errors.push(`${path}.undo_path: required`)
      if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        errors.push(`${path}.confidence: finite number in [0,1] required`)
      }
      if (typeof item.needs_human !== 'boolean') errors.push(`${path}.needs_human: boolean required`)
      if (typeof item.is_override !== 'boolean') errors.push(`${path}.is_override: boolean required`)
      if (item.is_override === true && !isNonEmptyString(item.override_reason)) {
        errors.push(`${path}.override_reason: required when is_override`)
      }
      const evidence = validateEvidence(item.evidence, validSignals, errors, path)
      plan.push({
        kind: isNonEmptyString(item.kind) ? (item.kind as MaintainPlanItemKind) : 'skill-level',
        names: Array.isArray(item.names) ? (item.names as string[]) : [],
        rule: str(item.rule, ''),
        evidence,
        finding: str(item.finding, ''),
        recommendation: str(item.recommendation, ''),
        semantic_reasoning: str(item.semantic_reasoning, ''),
        impact: isNonEmptyString(item.impact) ? (item.impact as MaintainImpact) : 'neutral',
        impact_reason: str(item.impact_reason, ''),
        reversibility: isNonEmptyString(item.reversibility) ? (item.reversibility as MaintainReversibility) : 'none',
        undo_path: str(item.undo_path, ''),
        confidence: typeof item.confidence === 'number' ? item.confidence : 0,
        needs_human: item.needs_human === true,
        is_override: item.is_override === true,
        override_reason: isNonEmptyString(item.override_reason) ? item.override_reason : undefined,
      })
    }
  }

  const notes = Array.isArray(raw.notes)
    ? (raw.notes as unknown[]).filter((note): note is string => isNonEmptyString(note))
    : []

  if (errors.length > 0) {
    return { ok: false, errors, plan: { verdict: verdict === 'no_issues' ? 'no_issues' : 'issues', plan, notes }, forcedHuman }
  }

  // Quality_low gate: skills whose quality_low=unknown have all structural
  // recommendations machine-forced to needs_human (011 §7).
  const unknownQualitySkills = new Set(
    report.skills
      .filter(skill => findDriftSignal(skill.signals, 'quality_low')?.verdict === 'unknown')
      .map(skill => skill.name),
  )
  for (const item of plan) {
    if (item.names.some(name => unknownQualitySkills.has(name)) && !item.needs_human) {
      item.needs_human = true
      forcedHuman.push(...item.names.filter(name => unknownQualitySkills.has(name)))
    }
  }

  for (const item of plan) {
    const referencesUnknown = item.evidence.some((ev) => {
      const signal = findSignalInReport(report, ev.signal)
      return signal?.verdict === 'unknown'
    })
    const lowConfidence = item.confidence < 0.6
    const irreversible = item.reversibility === 'rename' || item.reversibility === 'none'
    if (!item.needs_human && (lowConfidence || irreversible || item.is_override || referencesUnknown)) {
      item.needs_human = true
    }
  }

  return { ok: true, errors: [], plan: { verdict: verdict as MaintainVerdict, plan, notes }, forcedHuman }
}

function findSignalInReport(report: DriftReport, id: string): DriftSignal | undefined {
  return (
    report.library.find(signal => signal.id === id) ??
    report.skills.flatMap(skill => skill.signals).find(signal => signal.id === id)
  )
}
