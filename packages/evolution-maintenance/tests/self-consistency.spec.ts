/**
 * 011 §7 self-consistency suite — the four compile-time tests that keep the
 * template vocabulary and the mechanical facts/probe layer aligned:
 *   ① vocabulary: every template placeholder resolves via DRIFT_SIGNAL_NOUNS;
 *      rendered text carries no unresolved placeholders; the noun table and
 *      the probe signal set are the same vocabulary.
 *   ② no orphans / no dangling: every noun is referenced by the template
 *      (unused vocabulary = confusing the model); every template signal
 *      reference exists in the signal definitions.
 *   ③ example reproducibility: the template's threshold placeholders render
 *      engine values, and a fixture library reproduces the anchor example
 *      (stamp density over the threshold) exactly as the template claims.
 *   ④ plan evidence closure — owned by validate-plan.spec (rejects evidence
 *      outside the facts block); referenced here, not duplicated.
 */

import { describe, expect, it } from 'vitest'
import {
  DRIFT_SIGNAL_NOUNS,
  DRIFT_SIGNALS_VERSION,
  HEALTH_STAMP_RE,
  MAINTAIN_PROMPT,
  computeDriftSignals,
} from '@deepseek-ai/dsh-evolution-core'
import { PROBE_SIGNALS, computeProbe, renderMaintainTemplate as render } from '../src/index.ts'

function templateSignalRefs(): Set<string> {
  const refs = new Set<string>()
  const re = /\{\s*signal:([a-z_]+)(?:\.threshold)?\s*\}/g
  for (const match of MAINTAIN_PROMPT.matchAll(re)) {
    const id = match[1]
    if (id) refs.add(id)
  }
  return refs
}

describe('011 self-consistency', () => {
  it('① vocabulary: template refs resolve, render leaves no placeholder, noun table == probe signals', () => {
    const refs = templateSignalRefs()
    for (const id of refs) expect(DRIFT_SIGNAL_NOUNS[id]).toBeTruthy()
    const rendered = render(MAINTAIN_PROMPT, 'dsh-evolution@10', DRIFT_SIGNALS_VERSION, 'sig')
    expect(rendered).not.toContain('{signal:')
    expect(rendered).not.toContain('{bundle_version}')
    expect(rendered).not.toContain('{joint_signature}')
    const nounKeys = Object.keys(DRIFT_SIGNAL_NOUNS).sort()
    expect([...PROBE_SIGNALS].sort()).toEqual(nounKeys)
  })

  it('② no orphans: every noun appears in the template, every template ref exists', () => {
    const refs = templateSignalRefs()
    for (const id of Object.keys(DRIFT_SIGNAL_NOUNS)) {
      expect(refs.has(id)).toBe(true)
    }
    for (const id of refs) {
      expect(DRIFT_SIGNAL_NOUNS[id]).toBeTruthy()
    }
  })

  it('③ example reproducibility: threshold placeholder renders the engine value and the anchor example reproduces', () => {
    // Fixture that reproduces the template §5 anchor-vs-residue example: a
    // body above MIN_STAMP_BODY_CHARS with stamps past the 2/KB threshold.
    const stamps = Array.from({ length: 6 }, (_, index) => `rc.${index + 1}`).join('\n')
    const fixtureBody = `# D\n\n${stamps}\n\n` + 'x'.repeat(2_000)
    const report = computeDriftSignals([{ name: 'anchor-demo', body: fixtureBody }])
    const density = report.skills[0]?.signals.find(signal => signal.id === 'stamp_density')
    expect(density?.verdict).toBe('over')
    // The rendered template's threshold placeholder carries the same engine
    // constant the fixture reproduces (2/KB).
    const rendered = render(MAINTAIN_PROMPT, 'dsh-evolution@10', DRIFT_SIGNALS_VERSION, 'sig')
    expect(rendered).toContain('2/KB')
    // Probe detail derives from the same calculators (stamp sample matches).
    const probe = computeProbe('stamp_density', 'anchor-demo', [{ name: 'anchor-demo', body: fixtureBody }])
    expect(probe.detail[0]).toContain('/KB')
    expect((fixtureBody.match(HEALTH_STAMP_RE) ?? []).length).toBe(6)
  })

  it('④ evidence closure is enforced by the validator (cross-reference)', () => {
    // Owned by validate-plan.spec: 'rejects evidence that references a signal
    // outside the facts block'. This suite keeps the four-test contract
    // explicit rather than duplicating the rejection matrix.
    expect(PROBE_SIGNALS.length).toBeGreaterThan(0)
  })
})
