// @tier pre-tag
import { expect, it } from 'vitest'
import { buildFacts } from '../src/surface/merge-view.ts'

it('keeps active and last separate and uses processedPairs for terminal progress', () => {
  const active = { record: { id: 'r1', state: 'running', command: 'scan', progress: { done: 0, total: 2 }, startedAt: 1 }, meta: null, pairs: [], report: null }
  const last = { record: { id: 'r2', state: 'succeeded', command: 'scan', progress: { done: 0, total: 1 }, startedAt: 2, endedAt: 3 }, meta: null, pairs: [], report: { processedPairs: [{ pairKey: 'a\u0000b' }] } }
  const snapshot = { readAt: 5, queueRevision: 'x', runs: [active, last], rows: [], reports: [], report: null, history: [], bodyRefs: [], approval: { mergeApproval: false }, notes: [], degraded: false } as never
  const facts = buildFacts(snapshot)
  expect(facts.active?.id).toBe('r1')
  expect(facts.last?.id).toBe('r2')
  expect(facts.last?.progress).toEqual({ done: 1, total: 1 })
})
