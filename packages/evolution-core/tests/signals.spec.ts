import { describe, expect, it } from 'vitest'
import {
  advanceReview,
  type ReviewState,
  type SignalConfig,
  type TurnSignals,
} from '../src/signals.ts'

function cfg(over: Partial<SignalConfig> = {}): SignalConfig {
  return {
    memoryInterval: 10,
    skillInterval: 10,
    substantiveMinToolCalls: 3,
    substantiveMinUserChars: 0,
    substantiveMinAgentChars: 0,
    ...over,
  }
}

function sig(toolCalls: number, extra: Partial<TurnSignals> = {}): TurnSignals {
  return {
    substantive: false,
    toolCalls,
    userChars: 0,
    assistantChars: 0,
    memorySignal: false,
    skillSignal: false,
    ...extra,
  }
}

function freshState(): ReviewState {
  return { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: -1 }
}

describe('advanceReview (activity-weighted memory counter, G4.6)', () => {
  it('advances memory by the tool-call count when there is no memory signal', () => {
    const state = freshState()
    const config = cfg({ skillInterval: 999 })
    expect(advanceReview(state, 1, sig(4), config)).toBeNull()
    expect(state.turnsSinceMemory).toBe(4)
    expect(advanceReview(state, 2, sig(4), config)).toBeNull()
    expect(state.turnsSinceMemory).toBe(8)
  })

  it('advances memory by exactly 1 when a memory signal is present (not the tool-call count)', () => {
    const state = freshState()
    const config = cfg({ skillInterval: 999 })
    advanceReview(state, 1, sig(9, { memorySignal: true }), config)
    expect(state.turnsSinceMemory).toBe(1)
  })

  it('accumulates activity across mixed turns: 4 (no signal) + 1 (memory signal)', () => {
    const state = freshState()
    const config = cfg({ skillInterval: 999 })
    advanceReview(state, 1, sig(4), config)
    advanceReview(state, 2, sig(4, { memorySignal: true }), config)
    expect(state.turnsSinceMemory).toBe(5)
  })

  it('fires a memory review from accumulated activity alone and resets the counter', () => {
    const state = freshState()
    const config = cfg({ skillInterval: 999 })
    advanceReview(state, 1, sig(4), config)
    advanceReview(state, 2, sig(4), config)
    const kind = advanceReview(state, 3, sig(4), config)
    expect(kind).toBe('memory')
    expect(state.turnsSinceMemory).toBe(0)
  })

  it('keeps the skill counter activity-weighted (symmetry lock)', () => {
    const state = freshState()
    const config = cfg({ memoryInterval: 999 })
    advanceReview(state, 1, sig(4), config)
    expect(state.turnsSinceSkill).toBe(4)
  })
})
