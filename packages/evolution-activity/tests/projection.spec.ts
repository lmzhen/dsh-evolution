import { describe, expect, it } from 'vitest'
import { applyState, type State } from '../src/index.ts'

describe('evolution-activity projection', () => {
  it('folds plan-applied events into a bounded activity list', () => {
    let state: State = { items: [] }
    state = applyState(state, { type: 'evolution/plan-applied', data: { planId: 'p1', memoryApplied: 1, skillApplied: 1, rejectedOps: 0 }, seq: 1, time: 100 })
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ planId: 'p1', memoryApplied: 1 })
  })
})
