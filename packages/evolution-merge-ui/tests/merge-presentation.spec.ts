// @tier fast
import { expect, it } from 'vitest'
import { summarizePair } from '../src/client/merge-presentation.ts'

it('merges equal summaries once, keeps different ones separate, and reports missing honestly', () => {
  expect(summarizePair(' same ', 'same')).toEqual({ kind: 'same', text: 'same' })
  expect(summarizePair('left', 'right')).toEqual({ kind: 'different', a: 'left', b: 'right' })
  expect(summarizePair('left', null)).toEqual({ kind: 'different', a: 'left', b: null })
  expect(summarizePair(' ', null)).toEqual({ kind: 'missing' })
})
