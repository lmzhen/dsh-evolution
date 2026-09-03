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
    evidence: [{ signal: 'stamp_density', value: '0.5/KB' }],
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
  it('accepts a well-formed issues plan', () => {
    const result = validateAndNormalizeMaintainPlan(validPlan([validItem()]), report, SIGNALS)
    expect(result.ok).toBe(true)
    expect(result.plan.plan).toHaveLength(1)
  })

  it('accepts no_issues with an empty plan and rejects a non-empty one', () => {
    expect(validateAndNormalizeMaintainPlan(validPlan([]), report, SIGNALS).ok).toBe(true)
    const badRoot = { verdict: 'no_issues', plan: [validItem()], notes: [] }
    const bad = validateAndNormalizeMaintainPlan(badRoot, report, SIGNALS)
    expect(bad.ok).toBe(false)
    expect(bad.errors.some(e => e.includes('no_issues'))).toBe(true)
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

  it('applies the quality_low=unknown gate globally and reports forcedHuman', () => {
    const item = validItem({ names: ['no-quality-skill'], confidence: 0.9 })
    const result = validateAndNormalizeMaintainPlan(validPlan([item]), report, SIGNALS)
    expect(result.ok).toBe(true)
    expect(result.plan.plan[0]?.needs_human).toBe(true)
    expect(result.forcedHuman).toContain('no-quality-skill')
  })
})

describe('validation result shape', () => {
  it('unwinds malformed root into a deterministic error result', () => {
    const result: ValidationResult = validateAndNormalizeMaintainPlan(null, report, SIGNALS)
    expect(result.ok).toBe(false)
    expect(result.plan.plan).toEqual([])
  })
})
