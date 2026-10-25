// @tier pre-tag
import { expect, it } from 'vitest'
import { selectWithErrors } from '../src/adapters/select.ts'

it('host selector keeps judge errors in reportOnly for every level', () => {
  const selection = selectWithErrors({ pairs_final: [
    { a: 'a', b: 'b', level: 'L0', verdict_id: -1, reason: 'judge down', error: true },
    { a: 'c', b: 'd', level: 'L2', verdict_id: -1, reason: 'judge down', error: true },
  ] })
  expect(selection.candidates).toHaveLength(0)
  expect(selection.skipped).toHaveLength(0)
  expect(selection.reportOnly).toHaveLength(2)
})

it('keeps an L1 verdict=1 MERGE as a candidate', () => {
  const selection = selectWithErrors({ pairs_final: [
    { a: 'a', b: 'b', level: 'L1', verdict_id: 1, action: 'MERGE', reason: 'same capability', gate: { level: 'L1', verdict: 1 } },
  ] })
  expect(selection.candidates).toHaveLength(1)
})
