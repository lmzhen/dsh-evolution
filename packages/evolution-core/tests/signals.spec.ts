import { describe, expect, it } from 'vitest'
import {
  advanceReview,
  observeEvent,
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

  it('V6-21: a malformed assistant content skips instead of breaking the signal pipeline (0.3.37)', () => {
    const signal = sig(0)
    // `data.message.content` absent/non-array: the E-49 guard covered the user
    // branch only — the assistant branch used to throw and lose the turn's
    // signals to the review catch.
    observeEvent(signal, { type: 'assistant/message', data: { message: {} } } as never)
    expect(signal.assistantChars).toBe(0)
    observeEvent(signal, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hello' }] } } } as never)
    expect(signal.assistantChars).toBe(5)
  })

  it('N4 (v12): user/assistant branches with data:null skip instead of throwing', () => {
    // P1-1 guarded tool/call only; a persisted event with `data: null` used to
    // TypeError in the user/assistant branches and the review E-6 catch then
    // swallowed the whole turn's remaining signals.
    const signal = sig(0)
    expect(() => {
      observeEvent(signal, { type: 'user/message', data: null } as never)
      observeEvent(signal, { type: 'assistant/message', data: null } as never)
    }).not.toThrow()
    expect(signal.userChars).toBe(0)
    expect(signal.assistantChars).toBe(0)
  })

  it('N4 (v12): the shared guard keeps the tool/call branch counting after a null-data event', () => {
    const signal = sig(0)
    observeEvent(signal, { type: 'user/message', data: null } as never)
    observeEvent(signal, { type: 'tool/call', data: { name: 'skill' } } as never)
    expect(signal.toolCalls).toBe(1)
    expect(signal.skillSignal).toBe(true)
  })
})
