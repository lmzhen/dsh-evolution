import { describe, expect, it } from 'vitest'
import {
  computeDriftSignals,
  DRIFT_MAX_LINE_CHARS,
  duplicateHeadings,
  findDriftSignal,
  missingSupportPointers,
  narrowNameMatches,
  overlongLines,
  type DriftSkillSnapshot,
} from '../src/drift-signals.ts'

const HEALTHY = '# A\n\nintro\n\n## When to Use\n\n- x\n\n## Verification\n\n- y\n'

describe('drift-signals pure checks', () => {
  it('detects duplicate ## headings', () => {
    const body = '# A\n\n## When to Use\n\n## When to Use\n\n## Pitfalls\n'
    expect(duplicateHeadings(body)).toEqual([{ heading: 'When to Use', count: 2 }])
  })

  it('overlongLines reports 1-based line numbers and char counts', () => {
    const body = `short\n${'x'.repeat(DRIFT_MAX_LINE_CHARS + 10)}\nmedium`
    const result = overlongLines(body)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ lineNo: 2, chars: DRIFT_MAX_LINE_CHARS + 10 })
  })

  it('missingSupportPointers flags files absent from the body (by basename or path)', () => {
    expect(missingSupportPointers('# A\n\nsee references/x.md\n', ['references/x.md', 'references/y.md'])).toEqual([
      'references/y.md',
    ])
    expect(missingSupportPointers('# A\n\nsee y.md\n', ['references/y.md'])).toEqual([])
    expect(missingSupportPointers('# A\n', [])).toEqual([])
  })

  it('narrowNameMatches only flags session-artifact shapes', () => {
    expect(narrowNameMatches('fix-align-test-ops')).toContain('session-verb')
    expect(narrowNameMatches('err-sql-lock')).toContain('error-string')
    expect(narrowNameMatches('pr-42')).toContain('pr-number')
    expect(narrowNameMatches('align-test-ops')).toEqual([])
    expect(narrowNameMatches('python-3.12-tooling')).toEqual([])
    expect(narrowNameMatches('2026-09-02-summary')).toContain('dated')
  })
})

describe('computeDriftSignals', () => {
  const snapshots: DriftSkillSnapshot[] = [
    {
      name: 'align-test-ops',
      body: HEALTHY,
      description: 'Checks alignment-test workspace assets.',
      supportFiles: ['references/aa.md'],
      quality: 0.8,
      usageObserved: true,
    },
    {
      name: 'fix-align-bad',
      body: '# x\n\n## When to Use\n\n## When to Use\n\n' + 'yyyy'.repeat(400),
      description: 'A description that is definitely longer than sixty characters and keeps going and going on.',
      quality: 0.2,
      usageObserved: true,
    },
  ]

  it('reports unknown for missing inputs instead of fabricating pass/over', () => {
    const report = computeDriftSignals([
      { name: 'solo', body: HEALTHY, description: 'Short description.', usageObserved: null },
    ])
    expect(findDriftSignal(report.skills[0]?.signals ?? [], 'quality_low')?.verdict).toBe('unknown')
    expect(findDriftSignal(report.library, 'usage_observed')?.verdict).toBe('unknown')
    expect(findDriftSignal(report.skills[0]?.signals ?? [], 'description_chars')?.verdict).toBe('pass')
  })

  it('does not report usage_observed=observed for an empty library', () => {
    const report = computeDriftSignals([])
    expect(findDriftSignal(report.library, 'usage_observed')?.verdict).toBe('unknown')
  })

  it('flags layer drift on the bad skill and stays clean on the healthy one', () => {
    const report = computeDriftSignals(snapshots)
    const bad = report.skills[1]
    const good = report.skills[0]
    expect(findDriftSignal(bad?.signals ?? [], 'dup_heading')?.verdict).toBe('over')
    expect(findDriftSignal(bad?.signals ?? [], 'description_chars')?.verdict).toBe('over')
    expect(findDriftSignal(bad?.signals ?? [], 'quality_low')?.verdict).toBe('over')
    expect(findDriftSignal(good?.signals ?? [], 'dup_heading')?.verdict).toBe('pass')
    expect(findDriftSignal(good?.signals ?? [], 'quality_low')?.verdict).toBe('pass')
  })

  it('emits library-level dedup/prefix signals from the name set', () => {
    const report = computeDriftSignals([
      { name: 'align-a', body: HEALTHY },
      { name: 'align-b', body: HEALTHY },
      { name: 'solo-c', body: HEALTHY },
    ])
    const cluster = findDriftSignal(report.library, 'prefix_cluster')
    expect(cluster?.verdict).toBe('over')
    expect(cluster?.detail ?? '').toContain('key=align')
  })

  it('library signals are always present (pass=none when no group/cluster exists)', () => {
    const report = computeDriftSignals([
      { name: 'alpha-tool', body: HEALTHY },
      { name: 'gamma-helper', body: '# G\n\n## When to Use\n\n- z\n' },
    ])
    const dedup = findDriftSignal(report.library, 'dedup_group')
    expect(dedup?.verdict).toBe('pass')
    expect(dedup?.value).toBe('none')
    expect(findDriftSignal(report.library, 'prefix_cluster')?.verdict).toBe('pass')
  })
})
