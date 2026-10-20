// @tier pre-tag
import { expect, it } from 'vitest'
import { parseDecision } from '../src/index.ts'

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
