// @tier fast
import { expect, it } from 'vitest'
import type { MergeRow } from '../src/contracts.ts'
import { busyTarget } from '../src/runtime.ts'

const row = (id: string, retryable: boolean | undefined): MergeRow => ({
  id, pairKey: 'a\u0000b', a: 'a', b: 'b', state: 'fuse', queue: 'fuse',
  decision: { shouldMerge: true, mode: 'create-umbrella', target: 't', sources: ['a', 'b'], rationale: '', confidence: 1, aSummary: '', bSummary: '' },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...(retryable === undefined ? {} : { failure: { stage: 'author', code: 'E', message: 'x', retryable, retryFrom: 'agent2' } }),
}) as unknown as MergeRow

it('does not let a non-retryable fuse failure block the target forever', () => {
  expect(busyTarget([row('r1', false)], 't', 'me')).toBeUndefined()
  expect(busyTarget([row('r2', true)], 't', 'me')).toMatchObject({ id: 'r2' })
})
