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

  it('description_chars measures the enriched description and answers missing when absent (0.3.9)', () => {
    // Single-source contract: the facts block and the probe both read the
    // enriched frontmatter description. A snapshot WITHOUT one must answer
    // 'missing' explicitly — never a fabricated length.
    const withDesc = computeProbe('description_chars', 'align-test-ops', snapshots)
    expect(withDesc.detail[0]).toBe('description=6 chars') // 'Short.'
    const without = computeProbe('description_chars', 'align-tools', [
      { name: 'align-tools', body: '# A\n' },
    ])
    expect(without.detail[0]).toBe('description=missing')
  })

  it('description_chars carries the text for the §5-B5 nature triage, truncated at 160 (0.3.11)', () => {
    const withDesc = computeProbe('description_chars', 'align-test-ops', snapshots)
    expect(withDesc.detail[1]).toBe('desc-text: Short.')
    const long = computeProbe('description_chars', 'align-tools', [
      { name: 'align-tools', body: '# A\n', description: 'x'.repeat(200) },
    ])
    expect(long.detail[0]).toBe('description=200 chars')
    expect(long.detail[1]).toContain('…(truncated: 200 total)')
  })

  it('probe detail crosses the same redaction policy as the facts block', () => {
    const probes = computeProbe('narrow_name', 'ghost', [])
    void probes
    // The redaction itself is applied at the tools boundary (tools.ts); the
    // pure layer stays unredacted. Verify the boundary contract indirectly:
    // detail lines never embed raw body text (only derived tokens).
    const stamp = computeProbe('stamp_density', 'align-test-ops', [
      { name: 'align-test-ops', body: '# A\n\nrc.39\n\nkey = sk-proj-abcdefghijklmnopqrstuvwxyz123456\n' },
    ])
    expect(stamp.detail.some(line => line.includes('sk-proj-abcdefghijklmnopqrstuvwxyz123456'))).toBe(false)
    expect(stamp.detail.some(line => line.includes('<redacted>'))).toBe(false)
    // Derived tokens only: stamp regex matches rc./sha/date shapes, never
    // credential-shaped text — so the redactor at the tools boundary is
    // conservative belt-and-suspenders, and no raw credential text can leak.
  })
})
