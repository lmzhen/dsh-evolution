/**
 * Deterministic review signal gate.
 *
 * Scans a DSH session event log for durable learning signals before any LLM
 * is spent. `turn/end` calls `observeEvent`; the returned review kind is
 * accumulated until a configured interval fires.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { dispatchStepOf, isSkillToolName } from './tool-dispatch.ts'

export type ReviewKind = 'memory' | 'skill' | 'combined'

export interface SignalConfig {
  memoryInterval: number
  skillInterval: number
  substantiveMinToolCalls: number
  substantiveMinUserChars: number
  substantiveMinAgentChars: number
  /** 0.3.40 (user decision): the counting window restarts at the INJECTION, not
   * at the threshold fire. `false` keeps the counters MONOTONIC across fires
   * (the `>=` check still returns the kind; the caller resets the counters at
   * its own injection point). Default `true` preserves the historical
   * fire-resets window for existing callers/tests. */
  resetOnFire?: boolean
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

/** Text of one persisted content block, or `''` for any other shape.
 *
 * Content blocks cross the durable session-log boundary, so their runtime
 * shape is `unknown` even where the static event type promises
 * `{ type, text }`: a persisted `content: [null]` (A2-7, v18) used to throw a
 * TypeError here and the review catch swallowed the whole turn's remaining
 * signals. Keeping the guard in one helper also keeps the branches free of
 * conditions the static type already excludes.
 * @param block - one element of a persisted message `content` array.
 * @returns the block's text when it is a text block, otherwise an empty string.
 */
function textOfBlock(block: unknown): string {
  if (block === null || typeof block !== 'object') return ''
  const candidate = block as { type?: unknown; text?: unknown }
  return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
}

/**
 * The turn-window fold state: what {@link TurnSignals} carries plus its dispatch ledger.
 *
 * `opened` holds one ledger key per dispatch this window already counted
 * ({@link dispatchStepOf}). It lives in the state — not in a side table — because the state is
 * what a live projection unit and a whole-log fold both carry between events.
 */
export interface TurnFoldState extends TurnSignals {
  /** Ledger keys this window already counted, in first-seen order. */
  opened: string[]
}

/** The empty turn-window fold state. */
export function initialTurnFold(): TurnFoldState {
  return {
    substantive: false,
    toolCalls: 0,
    userChars: 0,
    assistantChars: 0,
    memorySignal: false,
    skillSignal: false,
    opened: [],
  }
}

/**
 * Fold ONE session event into a turn-window state, purely.
 *
 * The one fold behind all three readers: `observeEvent` (the mutating face the live `turn/end`
 * path uses), `foldTurn` (a whole-log window fold, kept for structural test sessions) and the
 * family's `evolutionSignals` projection unit. P1-1/N4 guards stay: events arrive from disk, so
 * a persisted `data: null` / non-object or a malformed `content` skips instead of throwing.
 * @param state - the window so far.
 * @param event - the next committed session event.
 * @returns the next state; the same reference when the event carries nothing this fold reads.
 */
export function foldTurnEvent(state: TurnFoldState, event: SessionEvent): TurnFoldState {
  const data: unknown = event.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return state
  if (event.type === 'user/message') {
    // 0.3.16 (E-49): a malformed content (not an array) used to throw here and
    // break the whole signal pipeline — guard and skip instead.
    const content = (data as { content?: unknown }).content
    if (!Array.isArray(content)) return state
    const text = content.map(textOfBlock).join(' ')
    return {
      ...state,
      userChars: state.userChars + text.length,
      memorySignal: state.memorySignal || CORRECTION_PATTERNS.some(pattern => pattern.test(text)),
      skillSignal: state.skillSignal || FIX_PATTERNS.some(pattern => pattern.test(text)),
    }
  }
  if (event.type === 'assistant/message') {
    // V6-21/V7-09: the same content guard the user branch got in E-49, extended to `message`
    // itself missing — `.content` on an absent message is the same TypeError one level up.
    const message = (data as { message?: { content?: Array<{ type: string; text?: string }> } }).message
    if (!message || !Array.isArray(message.content)) return state
    const text = message.content.map(textOfBlock).join(' ')
    return { ...state, assistantChars: state.assistantChars + text.length }
  }
  // Tool evidence (v37 P7a): the dispatch vocabulary lives in `tool-dispatch.ts` — the ONE reader
  // of the platform's dispatch event types — and `dispatchStepOf` is its pure half, so this fold
  // counts one tool call per dispatch whatever the runtime mode (native or PTC).
  // One widening assignment instead of a conditional spread: `SessionEvent`'s own type keeps `data`
  // required, while events arriving from disk may omit it — the vocabulary takes it optional.
  const frame: { type: string; data?: unknown } = event
  const dispatch = dispatchStepOf(frame)
  if (dispatch === null || dispatch.name === '' || state.opened.includes(dispatch.key)) return state
  // `toolCalls` is the model-facing call count the cadence weights by: a program's sub-dispatches
  // are not model calls (the `run_code` call that owns them is logged natively and counted by its
  // own `tool/call`), so only native dispatches advance it — which, since the vocabulary's dead
  // 'program-root' value was removed (S1-E6), is simply `kind !== 'program'`. This is the ONE
  // modality split the family's N17 guard table registers; do not add a second copy.
  let toolCalls = state.toolCalls
  if (dispatch.kind !== 'program') toolCalls += 1
  return {
    ...state,
    opened: [...state.opened, dispatch.key],
    toolCalls,
    skillSignal: state.skillSignal || isSkillToolName(dispatch.name),
  }
}

/**
 * Per-turn dispatch ledgers, keyed by the signal object they feed.
 *
 * `observeEvent` folds ONE event at a time, so the ledger has to outlive the call. One WeakMap
 * entry per `TurnSignals`, so a finished fold's ledger is collectable with the fold itself and two
 * concurrent turns never share one.
 */
const dispatchLedgers = new WeakMap<TurnSignals, readonly string[]>()

/** The ledger of the turn this signal is folding; empty before its first dispatch. */
function ledgerForSignal(signal: TurnSignals): readonly string[] {
  return dispatchLedgers.get(signal) ?? []
}

/**
 * Fold one session event into the current turn observation (the mutating face of
 * {@link foldTurnEvent}: every reader shares the one fold, this one copies the result back onto
 * the caller's signal object and keeps its ledger for the next event).
 * @param signal - the turn observation to advance.
 * @param event - the next committed session event.
 */
export function observeEvent(signal: TurnSignals, event: SessionEvent): void {
  const next = foldTurnEvent({ ...signal, opened: [...ledgerForSignal(signal)] }, event)
  signal.substantive = next.substantive
  signal.toolCalls = next.toolCalls
  signal.userChars = next.userChars
  signal.assistantChars = next.assistantChars
  signal.memorySignal = next.memorySignal
  signal.skillSignal = next.skillSignal
  dispatchLedgers.set(signal, next.opened)
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

  // Decision point 2 (0.3.24 G4.6): turnsSinceMemory is now ACTIVITY-weighted,
  // symmetric with turnsSinceSkill below — a turn without a memory signal
  // advances by the turn's tool-call count, so memory fires on accumulated
  // work rather than raw turn count. The field name is kept for on-disk
  // record compatibility; the semantic is documented here.
  state.turnsSinceMemory += signal.memorySignal ? 1 : Math.max(1, signal.toolCalls)
  // P3 (v3 audit): turnsSinceSkill is an ACTIVITY-weighted counter — a turn
  // without a skill signal advances by the turn's tool-call count (so skills
  // fire on accumulated work, not turn count). The field name is kept for
  // on-disk record compatibility; the semantic is documented here.
  state.turnsSinceSkill += signal.skillSignal ? 1 : Math.max(1, signal.toolCalls)

  const memoryDue = state.turnsSinceMemory >= config.memoryInterval
  const skillDue = state.turnsSinceSkill >= config.skillInterval
  // 0.3.40: with resetOnFire=false the counters stay monotonic — the caller
  // resets them at its injection point (the counting window is inject→inject).
  const zero = (): void => {
    state.turnsSinceMemory = 0
    state.turnsSinceSkill = 0
  }
  if (memoryDue && skillDue) {
    if (config.resetOnFire !== false) zero()
    return 'combined'
  }
  if (memoryDue) {
    if (config.resetOnFire !== false) state.turnsSinceMemory = 0
    return 'memory'
  }
  if (skillDue) {
    if (config.resetOnFire !== false) state.turnsSinceSkill = 0
    return 'skill'
  }
  return null
}

/**
 * Fold a log slice into one turn window, purely.
 *
 * The whole-log reference for {@link foldTurnEvent}: a caller that holds events (a fixture, a
 * structural view, a replay) reads a window without touching a platform Session. Production reads
 * the same window live from the family's `evolutionSignals` projection (`sessionTurnSignals`),
 * which folds `foldTurnEvent` once per committed event.
 * @param events - the log, oldest first. Pass an array, not a live iterator, when it can grow.
 * @param fromSeq - index of the first event of the window (0 for the whole log).
 * @returns the window's signals.
 */
export function foldTurnEvents(events: Iterable<SessionEvent>, fromSeq = 0): TurnSignals {
  // Materialize once: a live iterator must not be re-entered, and `Array.isArray` on an
  // `Iterable` would narrow to `any[]`.
  const list: readonly SessionEvent[] = [...events]
  let state = initialTurnFold()
  for (let index = Math.max(0, fromSeq); index < list.length; index += 1) {
    const event = list[index]
    if (event) state = foldTurnEvent(state, event)
  }
  const { substantive, toolCalls, userChars, assistantChars, memorySignal, skillSignal } = state
  return { substantive, toolCalls, userChars, assistantChars, memorySignal, skillSignal }
}
