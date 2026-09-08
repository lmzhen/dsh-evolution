import { describe, expect, it } from 'vitest'
import type { DriftReport } from '@deepseek-ai/dsh-evolution-core'
import { validateAndNormalizeMaintainPlan, type ValidationResult } from '../src/index.ts'

const report: DriftReport = {
  library: [
    { id: 'usage_observed', verdict: 'pass', value: 'observed' },
    { id: 'dedup_group', verdict: 'over', value: 'a, b', threshold: 'size >= 2', detail: 'members=a|b' },
  ],
  skills: [
    {
      name: 'healthy-skill',
      signals: [
        { id: 'stamp_density', verdict: 'pass', value: '0.5/KB', threshold: '2/KB' },
        { id: 'quality_low', verdict: 'pass', value: '0.80', threshold: '0.3' },
      ],
    },
    {
      name: 'no-quality-skill',
      signals: [{ id: 'quality_low', verdict: 'unknown', value: 'not-assessed' }],
    },
  ],
}

const SIGNALS = new Set<string>([
  'usage_observed',
  'dedup_group',
  'stamp_density',
  'quality_low',
  'dup_heading',
])

function validItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'skill-level',
    names: ['healthy-skill'],
    rule: 'B1',
    // E1 (P1-6, 0.3.58): the fixture report carries `dedup_group=over` at the
    // library level — a §3-compliant plan must cover it (evidence or notes).
    evidence: [{ signal: 'stamp_density', value: '0.5/KB' }, { signal: 'dedup_group', value: 'a, b' }],
    finding: 'stamp_density=pass',
    recommendation: '无动作（示例）',
    semantic_reasoning: '追溯锚判据',
    impact: 'better',
    impact_reason: '更清晰',
    reversibility: 'restructure',
    undo_path: 'restore 回退',
    confidence: 0.8,
    needs_human: false,
    is_override: false,
    ...overrides,
  }
}

function validPlan(items: unknown[] = []): Record<string, unknown> {
  return { verdict: items.length > 0 ? 'issues' : 'no_issues', plan: items, notes: [] }
}

describe('validateAndNormalizeMaintainPlan', () => {
  it('rejects items that name a protected skill (§7 enforced mechanically — 0.3.14 P3-5)', () => {
    const protectedReport: DriftReport = {
      library: report.library,
      skills: [{ name: 'pinned-skill', protected: 'pinned', signals: [{ id: 'stamp_density', verdict: 'over', value: '3/KB', threshold: '2/KB' }] }],
    }
    const item = validItem()
    item.names = ['pinned-skill']
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), protectedReport, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors?.join(' ')).toContain('protected')
  })

  it('accepts a well-formed issues plan', () => {
    const result = validateAndNormalizeMaintainPlan(validPlan([validItem()]), report, SIGNALS)
    expect(result.ok).toBe(true)
    expect(result.plan.plan).toHaveLength(1)
  })

  it('V5-23: an ambiguous case-only name fails loud with the exact-spelling instruction', () => {
    // A case-insensitive host may hold BOTH spellings — the lookup key names
    // two real skills and last-wins re-anchoring would be wrong.
    const dualReport: DriftReport = {
      library: report.library,
      skills: [
        { name: 'Foo', protected: undefined, signals: [{ id: 'stamp_density', verdict: 'over', value: '3/KB', threshold: '2/KB' }] },
        { name: 'foo', protected: undefined, signals: [{ id: 'stamp_density', verdict: 'over', value: '3/KB', threshold: '2/KB' }] },
      ],
    }
    const item = validItem()
    item.names = ['FOO']
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), dualReport, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors?.some(e => e.includes('exact spelling'))).toBe(true)
    // A distinct single-spelling name still anchors fine.
    item.names = ['Foo']
    expect(validateAndNormalizeMaintainPlan(validPlan([item]), dualReport, SIGNALS).ok).toBe(true)
  })

  it('accepts no_issues with an empty plan and rejects a non-empty one', () => {
    expect(validateAndNormalizeMaintainPlan(validPlan([]), report, SIGNALS).ok).toBe(true)
    const badRoot = { verdict: 'no_issues', plan: [validItem()], notes: [] }
    const bad = validateAndNormalizeMaintainPlan(badRoot, report, SIGNALS)
    expect(bad.ok).toBe(false)
    expect(bad.errors.some(e => e.includes('no_issues'))).toBe(true)
  })

  it('E1: an EMPTY issues plan over an over-signal report is refused (P1-6 completeness)', () => {
    const empty = validateAndNormalizeMaintainPlan({ verdict: 'issues', plan: [], notes: [] }, report, SIGNALS)
    expect(empty.ok).toBe(false)
    expect(empty.errors.some(e => e.includes('completeness'))).toBe(true)
    expect(empty.errors.some(e => e.includes('empty plan AND no notes'))).toBe(true)
  })

  it('E1: an uncovered over signal is refused even with a non-empty plan (P1-6)', () => {
    // The fixture report carries dedup_group=over; drop it from evidence and
    // name it nowhere — §3 fails loud.
    const item = validItem({ evidence: [{ signal: 'stamp_density', value: '0.5/KB' }] })
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('dedup_group'))).toBe(true)
    expect(result.errors.some(e => e.includes('completeness'))).toBe(true)
    // Naming the id in a note satisfies §3's explain-away clause.
    const withNote = validateAndNormalizeMaintainPlan(
      { verdict: 'issues', plan: [validItem()], notes: ['dedup_group 已人工评估：保留双技能'] },
      report,
      SIGNALS,
    )
    expect(withNote.ok).toBe(true)
  })

  it('rejects evidence that references a signal outside the facts block', () => {
    const item = validItem({
      evidence: [{ signal: 'invented-signal', value: 'x' }],
    })
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('not in the facts block'))).toBe(true)
  })

  it('rejects is_override without override_reason', () => {
    const item = validItem({ is_override: true })
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('override_reason'))).toBe(true)
  })

  it('normalizes a missing undo_path to n/a for irreversible items (0.3.6)', () => {
    const item = validItem({ reversibility: 'none' })
    delete item.undo_path
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(true)
    expect(result.plan.plan[0].undo_path).toBe('n/a')
  })

  it('does not mutate the caller\'s structured input (E-56)', () => {
    const item = validItem({ reversibility: 'none' })
    delete item.undo_path
    const root = validPlan([item])
    const result = validateAndNormalizeMaintainPlan(root, report, SIGNALS)
    expect(result.ok).toBe(true)
    // The normalized plan carries the truthful 'n/a' ...
    expect(result.plan.plan[0].undo_path).toBe('n/a')
    // ... WITHOUT writing it back onto the caller's input object (no in-place
    // `undo_path = 'n/a'` — the old code mutated the raw plan element).
    expect((root.plan as Record<string, unknown>[])[0]?.undo_path).toBeUndefined()
  })

  it('keeps undo_path required for reversible items (0.3.6)', () => {
    const item = validItem({ reversibility: 'restructure' })
    delete item.undo_path
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('undo_path'))).toBe(true)
  })

  it('rejects malformed verdict and missing required fields', () => {
    const root = validPlan([validItem({ kind: 'weird' })] as unknown[])
    root.verdict = 'maybe'
    const result = validateAndNormalizeMaintainPlan(root, report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('verdict'))).toBe(true)
    expect(result.errors.some(e => e.includes('kind'))).toBe(true)
  })

  it('imposes needs_human for low confidence, irreversible and unknown-referencing items', () => {
    const low = validItem({ confidence: 0.3 })
    const rename = validItem({ names: ['healthy-skill'], reversibility: 'rename', confidence: 0.9 })
    // evidence referencing quality_low=unknown on the no-quality skill
    const unknownRef = validItem({ evidence: [{ signal: 'quality_low', value: 'unknown' }], confidence: 0.9, names: ['no-quality-skill'] })
    const result = validateAndNormalizeMaintainPlan(validPlan([low, rename, unknownRef]), report, SIGNALS)
    expect(result.ok).toBe(true)
    const imposed = result.plan.plan
    expect(imposed[0]?.needs_human).toBe(true)
    expect(imposed[1]?.needs_human).toBe(true)
    expect(imposed[2]?.needs_human).toBe(true)
  })

  it('rejects NaN confidence (was allowed before isFinite)', () => {
    const item = validItem({ confidence: Number.NaN })
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('finite'))).toBe(true)
  })

  it('applies the quality_low=unknown gate globally and reports forcedHuman', () => {
    const item = validItem({ names: ['no-quality-skill'], confidence: 0.9 })
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(true)
    expect(result.plan.plan[0]?.needs_human).toBe(true)
    expect(result.forcedHuman).toContain('no-quality-skill')
  })

  it('F-326: rejects a plan item naming a skill not in the facts report', () => {
    const item = validItem({ names: ['ghost-skill'] })
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('not in the facts report'))).toBe(true)
    // A name that IS in the facts report passes the anchoring check.
    const ok = validateAndNormalizeMaintainPlan(validPlan([validItem({ names: ['healthy-skill'] })]), report, SIGNALS)
    expect(ok.ok).toBe(true)
  })

  it('V4-24 (F-326): trailing-space and case-mixed names resolve to the scanned skill', () => {
    const mixed = validItem({ names: ['  Healthy-Skill  '] })
    const result = validateAndNormalizeMaintainPlan(validPlan([mixed]), report, SIGNALS)
    expect(result.ok).toBe(true)
    // The output uses the canonical facts-report name so later consumers
    // (protected check, quality_low gate) stay consistent.
    expect(result.plan.plan[0].names).toEqual(['healthy-skill'])
    // A mixed-case name on a protected skill is still rejected through the
    // normalized key (the §7 rule is name-anchored, not formatting-anchored).
    const protectedReport: DriftReport = {
      library: report.library,
      skills: [{ name: 'pinned-skill', protected: 'pinned', signals: [{ id: 'stamp_density', verdict: 'over', value: '3/KB', threshold: '2/KB' }] }],
    }
    const pinned = validItem({ names: ['  PINNED-Skill  '] })
    const pinnedResult = validateAndNormalizeMaintainPlan(validPlan([pinned]), protectedReport, SIGNALS)
    expect(pinnedResult.ok).toBe(false)
    expect(pinnedResult.errors.some(e => e.includes('protected'))).toBe(true)
    // A name the facts report never scanned is still rejected (the F-326
    // hallucination guard is not weakened by the case-insensitive match).
    const bad = validItem({ names: ['  ghost-skill  '] })
    const badResult = validateAndNormalizeMaintainPlan(validPlan([bad]), report, SIGNALS)
    expect(badResult.ok).toBe(false)
    expect(badResult.errors.some(e => e.includes('not in the facts report'))).toBe(true)
  })
})

describe('validation result shape', () => {
  it('unwinds malformed root into a deterministic error result', () => {
    const result: ValidationResult = validateAndNormalizeMaintainPlan(null, report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.plan.plan).toEqual([])
  })
})
