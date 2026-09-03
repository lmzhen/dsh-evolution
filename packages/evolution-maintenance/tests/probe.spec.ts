import { describe, expect, it } from 'vitest'
import { computeDriftSignals, type DriftSkillSnapshot } from '@deepseek-ai/dsh-evolution-core'
import { computeProbe, PROBE_SIGNALS } from '../src/index.ts'

const snapshots: DriftSkillSnapshot[] = [
  {
    name: 'align-test-ops',
    body: '# A\n\n## When to Use\n\n- x\n' + 's'.repeat(1_600) + '\n',
    description: 'Short.',
    supportFiles: ['references/aa.md'],
    quality: 0.7,
  },
  {
    name: 'align-tools',
    body: '# A\n\n## When to Use\n\n- y\n',
    description: 'Short.',
  },
  {
    name: 'fix-align-bad',
    body: '# x\n\n## When to Use\n\n## When to Use\n\n' + 'y'.repeat(2_500),
    description: 'A description that is definitely longer than sixty characters and keeps going and going on.',
    supportFiles: ['references/unlinked.md'],
    quality: 0.2,
  },
]

describe('computeProbe', () => {
  it('exposes exactly the facts-block signal ids', () => {
    const report = computeDriftSignals(snapshots)
    const factIds = new Set<string>()
    for (const signal of report.library) factIds.add(signal.id)
    for (const skill of report.skills) for (const signal of skill.signals) factIds.add(signal.id)
    const missing = PROBE_SIGNALS.filter(id => !factIds.has(id))
    const extra = [...factIds].filter(id => !PROBE_SIGNALS.includes(id))
    expect(missing).toEqual([])
    expect(extra).toEqual([])
  })

  it('dedup_group/prefix_cluster details come from the same calculators as the facts block', () => {
    const report = computeDriftSignals(snapshots)
    const clusterFact = report.library.find(signal => signal.id === 'prefix_cluster')?.detail ?? ''
    const probe = computeProbe('prefix_cluster', undefined, snapshots)
    // Same membership source: both mention identical members.
    expect(probe.detail[0] ?? '').toContain('align')
    expect(probe.detail.some(line => line.includes('align-test-ops'))).toBe(true)
    expect(clusterFact).toContain('key=align')
  })

  it('skill-level detail agrees with the facts verdict (overlong/dup/pointer/narrow)', () => {
    const report = computeDriftSignals(snapshots)
    const bad = report.skills.find(skill => skill.name === 'fix-align-bad')
    expect(bad?.signals.find(signal => signal.id === 'dup_heading')?.verdict).toBe('over')
    const dupes = computeProbe('dup_heading', 'fix-align-bad', snapshots)
    expect(dupes.detail[0]).toContain('When to Use x2')
    const long = computeProbe('overlong_line', 'fix-align-bad', snapshots)
    expect(long.detail.length).toBeGreaterThan(0)
    expect(long.detail[0]).toMatch(/line \d+: \d+ chars/)
    const pointers = computeProbe('pointer_missing', 'fix-align-bad', snapshots)
    expect(pointers.detail).toContain('no body reference: references/unlinked.md')
    const narrow = computeProbe('narrow_name', 'fix-align-bad', snapshots)
    expect(narrow.detail[0]).toContain('session-verb')
  })

  it('reports missing targets and unknown signals explicitly', () => {
    expect(computeProbe('dup_heading', undefined, snapshots).detail[0]).toContain('requires a target')
    expect(computeProbe('not-a-signal', 'x', snapshots).detail[0]).toContain('unknown-signal')
    expect(computeProbe('dup_heading', 'ghost', snapshots).detail[0]).toContain('not found')
  })

  it('quality detail stays unknown when the snapshot lacks a score', () => {
    const probe = computeProbe('quality_low', 'align-test-ops', [
      { name: 'align-test-ops', body: '# A\n' },
    ])
    expect(probe.detail[0]).toBe('quality=unknown')
  })
})
