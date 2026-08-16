/**
 * Deterministic review signal gate.
 *
 * Scans a DSH session event log for durable learning signals before any LLM
 * is spent. `turn/end` calls `observeTurn`; the returned review kind is
 * accumulated until a configured interval fires.
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

export type ReviewKind = 'memory' | 'skill' | 'combined'

export interface SignalConfig {
  memoryInterval: number
  skillInterval: number
  substantiveMinToolCalls: number
  substantiveMinUserChars: number
  substantiveMinAgentChars: number
}

export interface TurnSignals {
  substantive: boolean
  toolCalls: number
  userChars: number
  assistantChars: number
  memorySignal: boolean
  skillSignal: boolean
}

export interface ReviewState {
  turnsSinceMemory: number
  turnsSinceSkill: number
  lastTurn: number
}

const CORRECTION_PATTERNS = [
  /(?:don'?t|do not|stop|never)\s+(?:do|use|format|explain|write|say)/i,
  /(?:too|very|way\s+too)\s+(?:verbose|long|detailed|short|brief)/i,
  /(?:I|we)\s+(?:prefer|like|want|need)\b/i,
  /remember\s+(?:this|that|to)/i,
]

const FIX_PATTERNS = [
  /worked after|fixed by|the fix was|root cause/i,
  /retry(?:ing)? worked|workaround/i,
]

/** Fold one session event into the current turn observation. */
export function observeEvent(signal: TurnSignals, event: SessionEvent): void {
  if (event.type === 'user/message') {
    const text = event.data.content
      .map(block => block.type === 'text' ? block.text : '')
      .join(' ')
    signal.userChars += text.length
    if (CORRECTION_PATTERNS.some(pattern => pattern.test(text))) signal.memorySignal = true
    if (FIX_PATTERNS.some(pattern => pattern.test(text))) signal.skillSignal = true
    return
  }
  if (event.type === 'assistant/message') {
    const text = event.data.message.content
      .map(block => block.type === 'text' ? block.text : '')
      .join(' ')
    signal.assistantChars += text.length
    return
  }
  if (event.type === 'tool/call') {
    signal.toolCalls += 1
    if (event.data.name === 'skill') signal.skillSignal = true
    if (event.data.name === 'skill_manage') signal.skillSignal = true
  }
}

/** Compute review cadence after `turn/end`. */
export function advanceReview(
  state: ReviewState,
  turn: number,
  signal: TurnSignals,
  config: SignalConfig,
): ReviewKind | null {
  if (turn === state.lastTurn) return null
  state.lastTurn = turn
  signal.substantive = signal.toolCalls >= config.substantiveMinToolCalls
    || signal.userChars >= config.substantiveMinUserChars
    || signal.assistantChars >= config.substantiveMinAgentChars
  if (!signal.substantive) return null

  state.turnsSinceMemory += signal.memorySignal ? 1 : 0
  state.turnsSinceSkill += signal.skillSignal ? 1 : Math.max(1, signal.toolCalls)

  const memoryDue = state.turnsSinceMemory >= config.memoryInterval
  const skillDue = state.turnsSinceSkill >= config.skillInterval
  if (memoryDue && skillDue) {
    state.turnsSinceMemory = 0
    state.turnsSinceSkill = 0
    return 'combined'
  }
  if (memoryDue) {
    state.turnsSinceMemory = 0
    return 'memory'
  }
  if (skillDue) {
    state.turnsSinceSkill = 0
    return 'skill'
  }
  return null
}

/** Fold all events between two sequence boundaries into one TurnSignals. */
export function foldTurn(session: Session, fromSeq: number): TurnSignals {
  const signal: TurnSignals = {
    substantive: false,
    toolCalls: 0,
    userChars: 0,
    assistantChars: 0,
    memorySignal: false,
    skillSignal: false,
  }
  for (let index = Math.max(0, fromSeq); index < session.events.length; index += 1) {
    const event = session.events[index]
    if (event) observeEvent(signal, event)
  }
  return signal
}
