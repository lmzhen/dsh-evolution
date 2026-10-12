/*
 * skill-lint — the FORM of a judgement, not a second judgement (G1, contract §3/§3b/§4, D1).
 *
 * The engine that DECIDES (token-scale line, /1024 stamp density, soft/2 support threshold) is
 * `skill-health.ts`; this module only re-expresses the facts it already computed as findings, so a
 * conclusion carries a rule id, a severity and a count instead of free text. Severity is declared
 * HERE, per rule — never scored by a model, never derived from statistics — so the same facts always
 * produce the same findings, on any machine, which is what lets CI replay a conclusion.
 *
 * Pure: no IO, no ctx, no thresholds of its own.
 */
import { SUPPORT_SPRAWL_FILES } from './constants.ts'

export type LintSeverity = 'warn' | 'error'

export interface LintFinding {
  severity: LintSeverity
  /** Stable rule id; findings are diffed by (rule, count), never by message text. */
  rule: string
  message: string
  /** How many times the rule bit — a name-only comparison hid one site becoming nine. */
  count: number
}

/** Size facts the deciding engine already measured. `null` means NOT MEASURED, never fine: a rule
 * that needs a missing fact stays silent rather than inventing a pass or a failure. */
export interface SkillDims {
  bodyChars: number | null
  bodyTokens: number | null
  stampDensityPerKb: number | null
  /** Support GROUPS (non-empty references/templates/scripts/assets dirs) — the old dimension. */
  supportGroups: number
  /** Support FILES under references/ (contract §4), or null when the caller cannot count them. */
  supportFiles: number | null
  /** Raw stamp hits behind `stampDensityPerKb` — the COUNT this rule reports (never a fixed 1). */
  stampHits: number | null
  churnPatches: number | null
  churnReads: number | null
}

/** The judgement itself, computed by `skill-health.ts` on its own scales; this module never
 * recomputes it from raw numbers (that is exactly how a second set of thresholds appears). */
export interface LintFacts {
  skillName: string
  dims: SkillDims
  softLineChars: number
  overSoftLine: boolean
  overTwiceSoftLine: boolean
  stampLimitPerKb: number
  /** The engine's own churn threshold — the rule must use the SAME number, not a literal. */
  churnMinPatches: number
  /** True when the caller could read the body at all. */
  readable: boolean
}

interface LintRule {
  readonly id: string
  readonly severity: LintSeverity
  run(facts: LintFacts): LintFinding | null
}

const msg = (parts: readonly (string | number)[]) => parts.map(p => (typeof p === 'string' ? p : String(p))).join('')

/** One rule yields AT MOST one finding (contract §3). `body-oversize-2x` is the only rule whose
 * severity can escalate a verdict to needs-restructure. */
export const RULES: readonly LintRule[] = [
  {
    id: 'unreadable-skill',
    severity: 'error',
    run: facts =>
      facts.readable && facts.dims.bodyChars !== null
        ? null
        : { severity: 'error', rule: 'unreadable-skill', message: msg([facts.skillName, ': SKILL.md could not be read — no health claim is possible']), count: 1 },
  },
  {
    id: 'body-oversize-2x',
    severity: 'error',
    run: facts =>
      facts.overTwiceSoftLine
        ? { severity: 'error', rule: 'body-oversize-2x', message: msg([facts.skillName, ': body is at or past twice the soft line (', facts.softLineChars, ' chars)']), count: 1 }
        : null,
  },
  {
    id: 'body-oversize',
    severity: 'warn',
    run: facts =>
      !facts.overTwiceSoftLine && facts.overSoftLine
        ? { severity: 'warn', rule: 'body-oversize', message: msg([facts.skillName, ': body is at or above the soft line (', facts.softLineChars, ' chars)']), count: 1 }
        : null,
  },
  {
    id: 'stamp-density',
    severity: 'warn',
    run: (facts) => {
      const density = facts.dims.stampDensityPerKb
      const hits = facts.dims.stampHits
      if (density === null || hits === null || density < facts.stampLimitPerKb) return null
      return { severity: 'warn', rule: 'stamp-density', message: msg([facts.skillName, ': stamp density ', density.toFixed(1), '/KB (rc/sha/date lines — log-like content)']), count: hits }
    },
  },
  {
    id: 'body-without-support',
    severity: 'warn',
    run: facts =>
      facts.dims.supportGroups === 0 && facts.dims.bodyChars !== null && facts.dims.bodyChars >= facts.softLineChars / 2
        ? { severity: 'warn', rule: 'body-without-support', message: msg([facts.skillName, ': large body (', facts.dims.bodyChars, ' chars) with NO support files']), count: 1 }
        : null,
  },
  {
    id: 'references-sprawl',
    severity: 'warn',
    run: (facts) => {
      const files = facts.dims.supportFiles
      if (files === null || files < SUPPORT_SPRAWL_FILES) return null
      return { severity: 'warn', rule: 'references-sprawl', message: msg([facts.skillName, ': ', files, ' support files']), count: files }
    },
  },
  {
    id: 'write-ghost',
    severity: 'warn',
    run: (facts) => {
      const patches = facts.dims.churnPatches
      const reads = facts.dims.churnReads
      if (patches === null || reads === null || patches < facts.churnMinPatches || reads > 0) return null
      return { severity: 'warn', rule: 'write-ghost', message: msg([facts.skillName, ': ', patches, ' patch(es), never read']), count: patches }
    },
  },
]

export function lintSkill(facts: LintFacts): LintFinding[] {
  const out: LintFinding[] = []
  for (const rule of RULES) {
    const hit = rule.run(facts)
    if (hit !== null) out.push(hit)
  }
  return out
}

/** What a write introduced, what got worse, what got fixed. A rule whose count grew (one site to
 * nine) counts as worsened — comparing by rule name alone reported nothing. */
export function diffFindings(
  before: readonly LintFinding[],
  after: readonly LintFinding[],
): { introduced: LintFinding[]; worsened: LintFinding[]; resolved: string[] } {
  const beforeByRule = new Map(before.map(f => [f.rule, f]))
  const afterByRule = new Map(after.map(f => [f.rule, f]))
  const introduced = after.filter(f => !beforeByRule.has(f.rule))
  const worsened = after.filter((f) => {
    const old = beforeByRule.get(f.rule)
    return old !== undefined && f.count > old.count
  })
  const resolved = before.filter(f => !afterByRule.has(f.rule)).map(f => f.rule)
  return { introduced, worsened, resolved }
}

/** Support files = markdown files under references/ (contract §4: unit frozen, underscore-prefixed
 * excluded). Paths are supplied by the caller — this module never touches the filesystem. */
export function countReferenceFiles(paths: readonly string[]): number {
  return paths.filter((p) => {
    const n = p.replace(/\\/g, '/')
    const inReferences = n.includes('/references/') || n.startsWith('references/')
    if (!inReferences || !n.endsWith('.md')) return false
    const base = n.slice(n.lastIndexOf('/') + 1)
    return !base.startsWith('_')
  }).length
}
