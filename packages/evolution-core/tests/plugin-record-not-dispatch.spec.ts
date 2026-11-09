// @tier pre-tag
import { expect, it } from 'vitest'
import { ToolDispatchNormalizer } from '../src/tool-dispatch.ts'

it('keeps plugin records out of the dispatch ledger even with call-shaped data', () => {
  const normalizer = new ToolDispatchNormalizer()
  expect(normalizer.advance({ type: 'plugin:skill-usage', ignorable: true, data: { callId: 'call-1', name: 'read' } })).toBeNull()
})
