import { describe, expect, it } from 'vitest'
import { computeDriftSignals, type DriftSkillSnapshot } from '@deepseek-ai/dsh-evolution-core'
import { renderFacts, summarizeAssessment } from '../src/index.ts'

const HEALTHY = '# A\n\n## When to Use\n\n- x\n'
const shortDescription = 'Does one thing well.'

void computeDriftSignals

describe('renderFacts', () => {
  const report = computeDriftSignals([
    {
      name: 'align-test-ops',
      body: HEALTHY,
      description: shortDescription,
      supportFiles: ['references/notes.md'],
      quality: 0.8,
    } satisfies DriftSkillSnapshot,
  ])

  it('renders the canonical block with signature and closed tags', () => {
    const rendered = renderFacts(report, { signalsVersion: '3', signature: 'abc123' })
    expect(rendered).toContain('<<<MECHANICAL_FACTS v=3 sig=abc123>>>')
    expect(rendered).toContain('<<<END FACTS>>>')
    expect(rendered).toContain('signal=dup_heading value=none verdict=pass')
    expect(rendered).toContain('signal=body_size')
    expect(rendered).toContain('# skill=align-test-ops')
  })

  it('always carries protection + catalog meta on every skill header (0.3.11)', () => {
    const rendered = renderFacts(report, { signalsVersion: '1', signature: 's' })
    expect(rendered).toContain('# skill=align-test-ops (protected=none catalog=visible)')
    const withMeta = computeDriftSignals([
      { name: 'pinned-skill', body: HEALTHY, protected: 'pinned' } satisfies DriftSkillSnapshot,
      { name: 'bad-yaml-skill', body: '---\nname: bad-yaml-skill\ndescription: a: b\n---\n\n# B\n', catalogInvalid: true } satisfies DriftSkillSnapshot,
    ])
    const rendered2 = renderFacts(withMeta, { signalsVersion: '1', signature: 's' })
    expect(rendered2).toContain('# skill=pinned-skill (protected=pinned catalog=visible)')
    expect(rendered2).toContain('# skill=bad-yaml-skill (protected=none catalog=yaml-invalid)')
  })

  it('redacts credential shapes from rendered values', () => {
    const secret = 'sk-proj-abcdefghijklmnop123456'
    const reportWithSecret = computeDriftSignals([{ name: 'leaky', body: `# A\n\nkey = ${secret}\n` }])
    const rendered = renderFacts(reportWithSecret, { signalsVersion: '1', signature: 's' })
    // The facts block renders signal values only, never body text — so a secret
    // inside the body must not appear in the output at all.
    expect(rendered).not.toContain(secret)
    // Signal values that DO carry secret shapes still get masked (e.g. a
    // support-file name or detail) — drive the redactor through a custom report.
    const reportWithSecretValue = {
      library: [],
      skills: [{ name: 'leaky', signals: [{ id: 'custom', verdict: 'over' as const, value: `token=${secret}`, threshold: '10' }] }],
    }
    const rendered2 = renderFacts(reportWithSecretValue, { signalsVersion: '1', signature: 's' })
    expect(rendered2).not.toContain(secret)
    expect(rendered2).toContain('<redacted>')
  })

  it('marks unknown verdicts with [UNKNOWN] lines', () => {
    const report = computeDriftSignals([{ name: 'solo', body: HEALTHY }])
    const rendered = renderFacts(report, { signalsVersion: '1', signature: 's' })
    expect(rendered).toContain('[UNKNOWN] signal=description_chars')
    expect(rendered).toContain('[UNKNOWN] signal=quality_low')
  })
})

describe('summarizeAssessment', () => {
  it('summarizes a clean skill', () => {
    const report = computeDriftSignals([{ name: 'clean', body: HEALTHY, description: shortDescription }])
    expect(summarizeAssessment(report.skills[0]!)).toBe('clean: clean')
  })

  it('summarizes over signals', () => {
    const report = computeDriftSignals([
      { name: 'fix-thing', body: '# x\n\n## A\n\n## A\n' + 'z'.repeat(2_500), description: 'x.y.'.repeat(20) },
    ])
    const summary = summarizeAssessment(report.skills[0]!)
    expect(summary).toContain('over')
    expect(summary.split(':')[1]?.trim().split(',')).toContain('dup_heading')
  })
})
