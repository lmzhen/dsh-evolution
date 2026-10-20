// @tier pre-tag
import { describe, expect, it } from 'vitest'
import {
  MERGE_PAIR_STATES,
  canRetry,
  emptyMergeState,
  pairKey,
  queueOf,
  stageOf,
  type MergePairRecord,
} from '../src/index.ts'

describe('merge contracts', () => {
  it('maps four states to three queues', () => {
    expect(MERGE_PAIR_STATES.map(queueOf)).toEqual(['retry', 'pending', 'retry', 'skipped'])
    expect(MERGE_PAIR_STATES.map(stageOf)).toEqual(['verify', 'decide', 'author', null])
  })

  it('builds symmetric pair keys', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'))
    expect(pairKey('a', 'b')).not.toBe(pairKey('a', 'c'))
  })

  it('starts empty with the current schema', () => {
    expect(emptyMergeState()).toEqual({ schemaVersion: 1, pairs: {} })
  })

  it('allows retry only when the failure is retryable and names a stage', () => {
    const base: MergePairRecord = { pairKey: 'a|b', a: 'a', b: 'b', state: 'fuse', updatedAt: '2026-10-20T00:00:00.000Z' }
    expect(canRetry(base)).toBe(true)
    expect(canRetry({ ...base, state: 'pending' })).toBe(false)
    expect(canRetry({ ...base, state: 'skipped' })).toBe(false)
    expect(canRetry({ ...base, failure: { stage: 'author', code: 'E', message: 'x', retryable: false, retryFrom: 'none' } })).toBe(false)
    expect(canRetry({ ...base, failure: { stage: 'author', code: 'E', message: 'x', retryable: true, retryFrom: 'agent2' } })).toBe(true)
  })
})
