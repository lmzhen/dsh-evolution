// @tier pre-tag
import { expect, it } from 'vitest'
import { parseDecision } from '../src/index.ts'
import { forcedDecisionFor } from '../src/runtime.ts'

const pair = { a: 'alpha-skill', b: 'beta-skill' }
const valid = { should_merge: true, mode: 'merge-into-existing', target: 'alpha-skill', sources: ['alpha-skill', 'beta-skill'], rationale: 'same', confidence: 0.9 }

it('parses a strict JSON decision', () => {
  expect(parseDecision(JSON.stringify(valid), pair)).toMatchObject({ ok: true, decision: { shouldMerge: true, target: 'alpha-skill', sources: ['alpha-skill', 'beta-skill'] } })
  expect(parseDecision('\`\`\`json\n' + JSON.stringify(valid) + '\n\`\`\`', pair)).toMatchObject({ ok: true, decision: { shouldMerge: true } })
})

it('maps keep and rejects invalid decisions', () => {
  expect(parseDecision(JSON.stringify({ ...valid, should_merge: false, mode: 'keep' }), pair)).toMatchObject({ ok: true, decision: { shouldMerge: false, mode: 'keep' } })
  expect(parseDecision(JSON.stringify({ ...valid, mode: 'other' }), pair)).toMatchObject({ ok: false, code: 'decision-invalid' })
  expect(parseDecision(JSON.stringify({ ...valid, target: '' }), pair)).toMatchObject({ ok: false })
  expect(parseDecision(JSON.stringify({ ...valid, sources: ['alpha-skill'] }), pair)).toMatchObject({ ok: false })
  expect(parseDecision('not json', pair)).toMatchObject({ ok: false })
})

it('parses create-umbrella and forced decisions with pending summaries', () => {
  expect(parseDecision(JSON.stringify({ ...valid, mode: 'create-umbrella', target: 'merge-a-b' }), pair)).toMatchObject({ ok: true, decision: { mode: 'create-umbrella', target: 'merge-a-b' } })
  const forced = forcedDecisionFor('a'.repeat(40), 'b'.repeat(40))
  expect(forced.target.length).toBeLessThanOrEqual(64)
  expect(forced).toMatchObject({ mode: 'create-umbrella', shouldMerge: true })
  expect(forced.aSummary.length).toBeGreaterThan(0)
  expect(forced.bSummary.length).toBeGreaterThan(0)
  expect(forced.rationale.length).toBeGreaterThan(0)
})

it('fails closed when maxTokens truncates the decision JSON', () => {
  const truncated = JSON.stringify(valid).slice(0, -10)
  expect(parseDecision(truncated, pair)).toMatchObject({ ok: false })
  expect(parseDecision('{"should_merge":true,"aSummary":"' + 'x'.repeat(1_000_000), pair)).toMatchObject({ ok: false })
})

it('keeps the two skill summaries for the pending row', () => {
  const withSummaries = { ...valid, aSummary: 'alpha does A', bSummary: 'beta does B' }
  expect(parseDecision(JSON.stringify(withSummaries), pair)).toMatchObject({ ok: true, decision: { aSummary: 'alpha does A', bSummary: 'beta does B' } })
  expect(parseDecision(JSON.stringify({ ...withSummaries, a_summary: 'snake A', b_summary: 'snake B', aSummary: undefined, bSummary: undefined }), pair)).toMatchObject({ ok: true, decision: { aSummary: 'snake A', bSummary: 'snake B' } })
})
