import { expect, it } from 'vitest'
import { evidenceKindIndex } from '@deepseek-ai/dsh-evolution-core'

it('classifies content frames as evidence and the turn/step bookends as bookkeeping', () => {
  const index = evidenceKindIndex([
    { type: 'turn/start', seq: 1 },
    { type: 'user/message', seq: 2 },
    { type: 'step/start', seq: 3 },
    { type: 'assistant/message', seq: 4 },
    { type: 'tool/call', seq: 5 },
    { type: 'tool/result', seq: 6 },
    { type: 'step/end', seq: 7 },
    { type: 'turn/end', seq: 8 },
  ])
  expect(index).toEqual(new Set([2, 4, 5, 6]))
})

it('an ALL-bookkeeping log is an empty set, not "cannot tell" (the two answers differ)', () => {
  expect(evidenceKindIndex([{ type: 'turn/start', seq: 1 }, { type: 'turn/end', seq: 2 }])).toEqual(new Set())
})

it('answers undefined when NO frame carries a usable seq — a log that cannot be classified', () => {
  // The stub-session shape every fixture uses: frames without seq. Reporting from this would
  // report every op in the plan.
  expect(evidenceKindIndex([{ type: 'user/message' }, { type: 'tool/call' }])).toBeUndefined()
  // A non-integer seq is not citable, so it is not classifiable either.
  expect(evidenceKindIndex([{ type: 'user/message', seq: 1.5 }, { type: 'turn/start', seq: '2' }])).toBeUndefined()
  expect(evidenceKindIndex([])).toBeUndefined()
  // One sequenced frame is enough to classify that frame; unsequenced frames are skipped, not
  // folded into either answer.
  expect(evidenceKindIndex([{ type: 'user/message' }, { type: 'user/message', seq: 9 }])).toEqual(new Set([9]))
})

it('an UNKNOWN frame type counts as content (the deny list keeps phase 1 free of false positives)', () => {
  // The platform vocabulary mixes content with state changes and out-of-repo plugins append
  // types this family cannot enumerate, so only the four pure bookends are denied.
  expect(evidenceKindIndex([{ type: 'evolution/plan-applied', seq: 3 }])).toEqual(new Set([3]))
  expect(evidenceKindIndex([{ seq: 4 }])).toEqual(new Set([4]))
})
