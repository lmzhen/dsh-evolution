/**
 * Maintain-plan validation and normalization (011 §7).
 *
 * Contract checks (mechanical, no semantics): enum membership, required
 * fields, evidence closed over the facts block's signal set, needs_human
 * consistency with the confidence/reversibility/is_override/unknown rules,
 * and the quality_low=unknown global imposition. Never judges whether a
 * recommendation is right — only whether it is well-formed and traceable.
 */

import { findDriftSignal, MAINTAIN_PROMPT, type DriftReport, type DriftSignal } from '@deepseek-ai/dsh-evolution-core'

/**
 * V27 D-3: the clause ids the maintain template ITSELF enumerates — the `- A1 …`
 * bullets of its §5 rule catalogue. `rule` is checked against this set (parsed
 * from the shipped template at module load, so a template edit that adds or
 * renames a clause moves the set with it) instead of the former bare
 * non-empty-string check, which let a plan cite a clause number that does not
 * exist and still pass mechanical validation. `self-consistency.spec.ts` pins
 * the parsed set so a template rewording cannot silently empty it.
 */
export const MAINTAIN_RULE_IDS: ReadonlySet<string> = new Set(
  [...MAINTAIN_PROMPT.matchAll(/^-\s+([A-D]\d)\s/gm)].map(match => match[1] as string),
)

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
  // 0.3.14 (P3-5): §7 "protected set → 0 recommendations" is enforced here —
  // the only component that audits a plan. `protected` flows into the report
  // since 0.3.11 (facts meta), so the data is already present.
  // V4-24 (F-326): names are matched trimmed and case-insensitively so a model
  // trailing-space or case difference cannot fail the whole scan. The output
  // uses the canonical facts-report name so every later consumer (protected
  // check, quality_low gate) stays consistent.
  const protectedNames = new Set<string>()
  const factNames = new Set<string>()
  const canonicalByName = new Map<string, string>()
  // V5-23 (0.3.32): a case-insensitive filesystem may hold BOTH `Foo` and
  // `foo` — the lookup key then names two real skills and last-wins
  // re-anchored recommendations to whichever scanned last. Anchoring must
  // fail loud with the exact-spelling instruction instead.
  // 0.3.34 (V6-01 配套): the EXACT spelling stays legal — only a non-exact
  // form of a multiple-spelling key is ambiguous; `Foo` must pass.
  const spellingsByName = new Map<string, Set<string>>()
  for (const skill of report.skills) {
    const key = skill.name.trim().toLowerCase()
    const trimmed = skill.name.trim()
    factNames.add(key)
    let spellings = spellingsByName.get(key)
    if (spellings === undefined) {
      spellings = new Set<string>()
      spellingsByName.set(key, spellings)
    }
    spellings.add(trimmed)
    const existing = canonicalByName.get(key)
    if (existing === undefined) canonicalByName.set(key, trimmed)
    if (skill.protected) protectedNames.add(key)
  }

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
      const rawNames = Array.isArray(item.names) ? (item.names as string[]) : []
      let namesOut: string[] = []
      if (rawNames.length === 0 || !rawNames.every(isNonEmptyString)) {
        errors.push(`${path}.names: non-empty string array required`)
      } else {
        // V4-24 (F-326): trim each name and resolve it to the canonical facts
        // name via a case-insensitive lookup. A name the facts report never
        // scanned stays as its trimmed self and fails the anchoring check below.
        namesOut = rawNames.map((nm) => {
          const trimmed = nm.trim()
          const key = trimmed.toLowerCase()
          const spellings = spellingsByName.get(key)
          if (spellings === undefined) return trimmed
          // The EXACT spelling is always legal (a real skill on a
          // case-sensitive host); only a single spelling gets the canonical
          // re-anchor; a multiple-spelling key keeps the trimmed input so the
          // ambiguity check below can name it.
          if (spellings.has(trimmed)) return trimmed
          if (spellings.size === 1) return canonicalByName.get(key) ?? trimmed
          return trimmed
        })
        // V5-23 (0.3.34): a name that maps ambiguously (two real skills
        // differing only in case, and the input matches neither exactly) is
        // refused outright — never re-anchored to one of them.
        const ambiguousHit = namesOut.find((nm) => {
          const key = nm.trim().toLowerCase()
          const spellings = spellingsByName.get(key)
          return spellings !== undefined && spellings.size > 1 && !spellings.has(nm.trim())
        })
        if (ambiguousHit !== undefined) {
          errors.push(`${path}.names: "${ambiguousHit}" matches multiple differently-cased skill names in the facts report — use the exact spelling`)
        } else {
          const missing = namesOut.find(nm => !factNames.has(nm.toLowerCase()))
          if (missing !== undefined) {
            errors.push(`${path}.names: references skill "${missing}" not in the facts report — names must come from the scanned skill set`)
          } else {
            const hit = namesOut.find(nm => protectedNames.has(nm.toLowerCase()))
            if (hit !== undefined) {
              errors.push(`${path}.names: references protected skill "${hit}" — §7 forbids recommendations for bundled/hub-installed/pinned skills`)
            }
          }
        }
      }
      if (!isNonEmptyString(item.rule)) errors.push(`${path}.rule: required`)
      else if (!MAINTAIN_RULE_IDS.has(item.rule.trim())) {
        // V27 D-3: the template enumerates its clauses; a cited id outside that
        // set is a fabricated rule (or a stale one) and must not pass.
        errors.push(`${path}.rule: "${item.rule}" is not a clause id the maintain template defines (${[...MAINTAIN_RULE_IDS].sort().join(', ')})`)
      }
      if (typeof item.finding !== 'string' || item.finding.trim().length === 0) errors.push(`${path}.finding: required`)
      if (!isNonEmptyString(item.recommendation)) errors.push(`${path}.recommendation: required`)
      if (!isNonEmptyString(item.semantic_reasoning)) errors.push(`${path}.semantic_reasoning: required`)
      if (typeof item.impact !== 'string' || !IMPACTS.has(item.impact)) errors.push(`${path}.impact: invalid`)
      if (!isNonEmptyString(item.impact_reason)) errors.push(`${path}.impact_reason: required`)
      if (typeof item.reversibility !== 'string' || !REVERSIBILITIES.has(item.reversibility)) {
        errors.push(`${path}.reversibility: invalid`)
      }
      // 0.3.6 / E-56: irreversible items may omit/empty undo_path — normalize to
      // the truthful 'n/a' on the COPIED plan object (never the caller's input).
      // Reversible items keep the hard requirement: a fabricated undo path is
      // never acceptable.
      let normalizedUndoPath: string | undefined
      if (isNonEmptyString(item.undo_path)) {
        normalizedUndoPath = item.undo_path
      } else if (item.reversibility === 'none') {
        normalizedUndoPath = 'n/a'
      } else {
        const rev = typeof item.reversibility === 'string' ? item.reversibility : 'missing'
        errors.push(`${path}.undo_path: required (reversibility=${rev})`)
      }
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
        names: namesOut,
        rule: str(item.rule, ''),
        evidence,
        finding: str(item.finding, ''),
        recommendation: str(item.recommendation, ''),
        semantic_reasoning: str(item.semantic_reasoning, ''),
        impact: isNonEmptyString(item.impact) ? (item.impact as MaintainImpact) : 'neutral',
        impact_reason: str(item.impact_reason, ''),
        reversibility: isNonEmptyString(item.reversibility) ? (item.reversibility as MaintainReversibility) : 'none',
        undo_path: normalizedUndoPath ?? str(item.undo_path, ''),
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

  // E1 (P1-6, v11): the §3 completeness contract — every OVER verdict signal
  // in the facts block must be COVERED: referenced as evidence in some plan
  // item, or named in a note. An empty `{issues, [], []}` (a silently skipped
  // over signal) used to pass as a legitimate scan; now it fails like the
  // existing verdict=no_issues-with-plan symmetry check. Semantic correctness
  // of a note stays out of scope (template §3 leaves that to the reviewer).
  const overSignals = new Set<string>()
  for (const signal of report.library) if (signal.verdict === 'over') overSignals.add(signal.id)
  for (const skill of report.skills) {
    for (const signal of skill.signals) if (signal.verdict === 'over') overSignals.add(signal.id)
  }
  const covered = new Set(plan.flatMap(item => item.evidence.map(ev => ev.signal)))
  const notesText = notes.join('\n')
  // V24-19 (v24): the coverage check covers the `no_issues` verdict too.
  // `no_issues` remains a legitimate no-action output (§7), but a no_issues
  // verdict WITH over signals in the facts and no notes anywhere was the same
  // silent skip E1 closed on the issues side — one lazy/hallucinated sweep
  // verdict zeroed every over signal with nothing rendered but "No drift
  // issues detected." A no_issues with over signals now requires notes that
  // name (explain away) each signal; a no_issues on a clean facts block is
  // untouched.
  if (verdict === 'issues') {
    if (plan.length === 0 && notes.length === 0 && overSignals.size > 0) {
      errors.push('completeness: verdict=issues with an empty plan AND no notes — every over signal must be covered by evidence or named in a note (§3)')
    } else {
      const uncovered = [...overSignals].filter(id => !covered.has(id) && !notesText.includes(id))
      if (uncovered.length > 0) {
        errors.push(`completeness: over signal(s) not covered by any plan evidence nor named in a note (${uncovered.join(', ')}) — §3 requires each over signal to be addressed or explicitly explained away`)
      }
    }
  } else if (verdict === 'no_issues' && overSignals.size > 0) {
    // V25-04 (v25): the notes check is PER-SIGNAL (same notesText.includes
    // discipline as the issues branch above) — the first cut only required
    // notes to be NON-EMPTY, so one unrelated boilerplate note zero-explained
    // every over signal while the error message claimed "explain each
    // signal".
    const uncovered = [...overSignals].filter(id => !notesText.includes(id))
    if (uncovered.length > 0) {
      errors.push(`completeness: verdict=no_issues while the facts block carries over signal(s) not named in any note (${uncovered.join(', ')}) — each signal must be explicitly explained away in notes (§3/§7)`)
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, plan: { verdict: verdict === 'no_issues' ? 'no_issues' : 'issues', plan, notes }, forcedHuman }
  }

  // Quality_low gate: skills whose quality_low=unknown have all structural
  // recommendations machine-forced to needs_human (011 §7).
  // V27 M-07: the set uses the SAME canonical spelling as `namesOut` (trimmed,
  // see canonicalByName above). Comparing the raw `skill.name` here let a
  // directory name with surrounding whitespace bypass the gate entirely: the
  // item's name was canonicalized to the trimmed form while this set held the
  // padded one, so the lookup missed and the recommendation stayed
  // machine-actionable.
  const unknownQualitySkills = new Set(
    report.skills
      .filter(skill => findDriftSignal(skill.signals, 'quality_low')?.verdict === 'unknown')
      .map(skill => skill.name.trim()),
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
