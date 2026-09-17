import { describe, expect, it } from 'vitest'
import { resolveCitations } from '../src/citations.ts'
import { bodyCost } from '../src/cost.ts'
import {
  computeDriftSignals,
  DRIFT_MAX_LINE_CHARS,
  duplicateHeadings,
  findDriftSignal,
  missingSupportPointers,
  narrowNameMatches,
  overlongLines,
  retirementReport,
  type DriftSkillSnapshot,
} from '../src/drift-signals.ts'

const HEALTHY = '# A\n\nintro\n\n## When to Use\n\n- x\n\n## Verification\n\n- y\n'
const OTHER_BODY = '# G\n\n## When to Use\n\n- z\n'

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

describe('demand signal (design §5.5)', () => {
  const files = ['references/a.md', 'references/b.md']

  it('answers unknown until the support files are enumerated', () => {
    const report = computeDriftSignals([{ name: 's', body: HEALTHY, usageObserved: true }])
    const signal = findDriftSignal(report.skills[0]?.signals ?? [], 'demand')
    expect(signal?.verdict).toBe('unknown')
    expect(signal?.value).toBe('not-enumerated')
  })

  it('answers unknown while the observation window is closed — zero is not evidence', () => {
    const report = computeDriftSignals([{ name: 's', body: HEALTHY, supportFiles: files, usageObserved: false }])
    const signal = findDriftSignal(report.skills[0]?.signals ?? [], 'demand')
    expect(signal?.verdict).toBe('unknown')
    expect(signal?.value).toBe('window-closed')
  })

  it('flags the never-read files once the window is open', () => {
    const report = computeDriftSignals([
      { name: 's', body: HEALTHY, supportFiles: files, usageObserved: true, demand: { 'references/a.md': 3 } },
    ])
    const signal = findDriftSignal(report.skills[0]?.signals ?? [], 'demand')
    expect(signal?.verdict).toBe('over')
    expect(signal?.value).toBe('cold=1/2')
    expect(signal?.detail ?? '').toContain('references/b.md')
  })

  it('passes when every enumerated file has been read', () => {
    const report = computeDriftSignals([
      { name: 's', body: HEALTHY, supportFiles: files, usageObserved: true, demand: { 'references/a.md': 1, 'references/b.md': 2 } },
    ])
    const signal = findDriftSignal(report.skills[0]?.signals ?? [], 'demand')
    expect(signal?.verdict).toBe('pass')
    expect(signal?.value).toBe('2 warm')
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

  it('unenumerated support files yield unknown, never a fabricated pass', () => {
    const report = computeDriftSignals([{ name: 'solo', body: HEALTHY }])
    const pointer = findDriftSignal(report.skills[0]?.signals ?? [], 'pointer_missing')
    expect(pointer?.verdict).toBe('unknown')
    expect(pointer?.value).toBe('not-enumerated')
  })

  it('usage_observed=false reports pass/unobserved (truthful value text)', () => {
    const report = computeDriftSignals([
      { name: 'a', body: HEALTHY, usageObserved: false },
      { name: 'b', body: OTHER_BODY, usageObserved: false },
    ])
    const signal = findDriftSignal(report.library, 'usage_observed')
    expect(signal?.verdict).toBe('pass')
    expect(signal?.value).toBe('unobserved')
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

describe('S1.8 (v37 P1-14 / P2-3): LF and CRLF bodies agree', () => {
  it('duplicateHeadings sees headings in a CRLF body', () => {
    // `.` does not match `\r` and a non-multiline `$` anchors only at the end of
    // the input, so a CRLF body reported `dup_heading: none / pass` — a fabricated
    // positive verdict (the maintenance prompt never asked for the merge).
    const lf = '## A\n\ntext\n\n## A\n'
    expect(duplicateHeadings(lf)).toEqual([{ heading: 'A', count: 2 }])
    expect(duplicateHeadings(lf.replace(/\n/g, '\r\n'))).toEqual([{ heading: 'A', count: 2 }])
  })

  it('overlongLines counts visible characters, not the CR terminator', () => {
    const exact = 'x'.repeat(DRIFT_MAX_LINE_CHARS)
    expect(overlongLines(`${exact}\n`)).toEqual([])
    expect(overlongLines(`${exact}\r\n`)).toEqual([])
    const over = 'x'.repeat(DRIFT_MAX_LINE_CHARS + 1)
    expect(overlongLines(`${over}\n`)).toEqual([{ lineNo: 1, chars: DRIFT_MAX_LINE_CHARS + 1 }])
    expect(overlongLines(`${over}\r\n`)).toEqual([{ lineNo: 1, chars: DRIFT_MAX_LINE_CHARS + 1 }])
  })
})

describe('support-file cap report (V4, design §16.6)', () => {
  it('names oversize support files in the body_size detail, and claims nothing when unmeasured', () => {
    const measured = computeDriftSignals([{
      name: 's',
      body: HEALTHY,
      cost: bodyCost(HEALTHY),
      supportChars: { 'references/release-log.md': 189_444, 'references/small.md': 500 },
    }])
    const signal = findDriftSignal(measured.skills[0]?.signals ?? [], 'body_size')
    expect(signal?.detail).toContain('oversize support file(s): references/release-log.md(189444)')
    expect(signal?.detail).not.toContain('small.md')
    // No measurement -> no claim (unknown is not zero).
    const unmeasured = computeDriftSignals([{ name: 's', body: HEALTHY, cost: bodyCost(HEALTHY) }])
    expect(findDriftSignal(unmeasured.skills[0]?.signals ?? [], 'body_size')?.detail ?? '').not.toContain('oversize')
  })
})

describe('support-file retirement evidence (design §5.6)', () => {
  // dead.md is the retirement shape: mentioned nowhere, read never, unkept.
  const files = ['references/a.md', 'references/b.md', 'references/kept.md', 'references/unhooked.md', 'references/dead.md']
  const body = [
    '# A',
    '',
    '## 何时用',
    '',
    '- 症状甲 → references/a.md',
    '- 症状乙 → references/b.md',
    '',
    '<!-- keep: references/kept.md 会话实录，冷是正常的 -->',
    '',
    '见 references/unhooked.md',
    '',
  ].join('\n')
  const citations = resolveCitations({ content: body, file: 'SKILL.md', files })

  it('reports mentioned-but-unhooked files as detail without moving the verdict', () => {
    const report = computeDriftSignals([{ name: 's', body, supportFiles: files, citations, usageObserved: true }])
    const pointer = findDriftSignal(report.skills[0]?.signals ?? [], 'pointer_missing')
    // The verdict still follows the missing file only; the hook gap rides detail,
    // and a file whose mention IS its keep marker is exempt from both.
    expect(pointer?.verdict).toBe('over')
    expect(pointer?.value).toBe('references/dead.md')
    expect(pointer?.detail).toBe('unhooked=1: references/unhooked.md')
  })

  it('never lists a directory entry as unhooked or as a retirement candidate', () => {
    const withDir = [...files, 'references/archive']
    const report = computeDriftSignals([{ name: 's', body, supportFiles: withDir, citations, usageObserved: true }])
    const pointer = findDriftSignal(report.skills[0]?.signals ?? [], 'pointer_missing')
    expect(pointer?.detail).toBe('unhooked=1: references/unhooked.md')
    const retire = retirementReport({ name: 's', body, supportFiles: withDir, citations, liveness: { idleDays: 45 } }, withDir)
    expect(retire.candidates.map(candidate => candidate.path)).toEqual(['references/dead.md'])
  })

  it('leaves a fully hooked body without hook detail', () => {
    const hooked = '- 症状甲 → references/a.md\n'
    const report = computeDriftSignals([{ name: 's', body: hooked, supportFiles: ['references/a.md'], usageObserved: true }])
    expect(findDriftSignal(report.skills[0]?.signals ?? [], 'pointer_missing')?.detail).toBeUndefined()
  })

  it('proposes only cold, uncited, unkept files once the skill is idle past the stale window', () => {
    const report = retirementReport({ name: 's', body, supportFiles: files, citations, liveness: { idleDays: 45 } }, files)
    expect(report.status).toBe('listed')
    // unhooked.md is cited in prose, so only the never-mentioned file qualifies.
    expect(report.candidates).toEqual([{ path: 'references/dead.md', idleDays: 45 }])
  })

  it('keeps every file out of the list while the skill is inside the grace window', () => {
    const report = retirementReport({ name: 's', body, supportFiles: files, citations, liveness: { idleDays: 3 } }, files)
    expect(report.status).toBe('none')
    expect(report.candidates).toEqual([])
  })

  it('never reads an unmeasurable input as "nothing qualifies"', () => {
    expect(retirementReport({ name: 's', body, supportFiles: files, citations }, files).status).toBe('no-age')
    expect(retirementReport({ name: 's', body, supportFiles: files, liveness: { idleDays: 45 } }, files).status).toBe('unscanned')
  })

  it('carries the retirement list on the demand signal without changing its verdict', () => {
    const report = computeDriftSignals([
      { name: 's', body, supportFiles: files, citations, usageObserved: true, liveness: { idleDays: 45 }, demand: { 'references/a.md': 2 } },
    ])
    const demand = findDriftSignal(report.skills[0]?.signals ?? [], 'demand')
    expect(demand?.verdict).toBe('over')
    expect(demand?.value).toBe('cold=4/5')
    expect(demand?.detail).toContain('retire≥30d: references/dead.md(45d)')
  })
})

