// @tier pre-tag
import { describe, expect, it } from 'vitest'
import {
  MERGE_PAIR_STATES,
  canRetry,
  emptyMergeState,
  pairKey,
  queueOf,
  stageOf,
  type MergeRow,
} from '../src/index.ts'

describe('merge contracts', () => {
  it('maps five states to four queues', () => {
    expect(MERGE_PAIR_STATES.map(queueOf)).toEqual(['verify', 'pending', 'fuse', 'fuse', 'skipped'])
    expect(MERGE_PAIR_STATES.map(stageOf)).toEqual(['verify', 'decide', 'author', 'author', null])
  })

  it('builds symmetric pair keys', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'))
    expect(pairKey('a', 'b')).not.toBe(pairKey('a', 'c'))
  })

  it('starts empty with the current schema', () => {
    expect(emptyMergeState()).toEqual({ schemaVersion: 2, rows: [] })
  })

  it('allows retry only when the failure is retryable and names a stage', () => {
    const base: MergeRow = { id: 'mr_a', pairKey: 'a|b', a: 'a', b: 'b', state: 'fuse', queue: 'fuse', createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' }
    expect(canRetry(base)).toBe(true)
    expect(canRetry({ ...base, state: 'pending' })).toBe(false)
    expect(canRetry({ ...base, state: 'skipped' })).toBe(false)
    expect(canRetry({ ...base, failure: { stage: 'author', code: 'E', message: 'x', retryable: false, retryFrom: 'none' } })).toBe(false)
    expect(canRetry({ ...base, failure: { stage: 'author', code: 'E', message: 'x', retryable: true, retryFrom: 'agent2' } })).toBe(true)
  })
})
