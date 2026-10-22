// @tier pre-tag
import { expect, it } from 'vitest'
import { selectWithErrors } from '../src/adapters/select.ts'

it('host selector routes judge errors to candidates for every level', () => {
  const selection = selectWithErrors({ pairs_final: [
    { a: 'a', b: 'b', level: 'L0', verdict_id: -1, reason: 'judge down', error: true },
    { a: 'c', b: 'd', level: 'L2', verdict_id: -1, reason: 'judge down', error: true },
  ] })
  expect(selection.candidates).toHaveLength(2)
  expect(selection.skipped).toHaveLength(0)
  expect(selection.reportOnly).toHaveLength(0)
})
