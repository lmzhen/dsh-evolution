/**
 * The pending card's state machine, kept OUT of the component so the three states the review asked for
 * can be asserted without a browser (and so a second rendering of the same data cannot invent a fourth).
 *
 * The one rule worth naming: LOADING and EMPTY are different states with different copy. The skill
 * history panel shipped them merged once and a reader could not tell "nothing is staged" from "the
 * answer has not arrived" (E7).
 * @module @deepseek-ai/dsh-evolution-settings-ui/client/pending-state
 */
import type { PendingRow, PreviewAnswer } from './api.ts'

/** What one row's preview is showing while it is open. */
export type PreviewView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly answer: Extract<PreviewAnswer, { available: true }> }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'failed'; readonly message: string }

/** What the card is showing right now. */
export type PendingView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly PendingRow[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed'; readonly message: string }

/** The whole card state: the view, the ids with an action in flight, and the last refusal line. */
export interface PendingState {
  readonly view: PendingView
  readonly busy: readonly string[]
  readonly notice: string | null
  /** The row whose preview is open, or null. One at a time: a preview is a thing being read. */
  readonly open: string | null
  readonly preview: PreviewView | null
}

/** The state a card mounts in: still loading, nothing in flight, nothing said yet. */
export const INITIAL_PENDING_STATE: PendingState = { view: { kind: 'loading' }, busy: [], notice: null, open: null, preview: null }

/** Open one row's preview: the row is now the open one and its answer is on the way. */
export function expanded(state: PendingState, id: string): PendingState {
  return { ...state, open: id, preview: { kind: 'loading' } }
}

/** Close whatever preview is open. */
export function collapsed(state: PendingState): PendingState {
  return { ...state, open: null, preview: null }
}

/**
 * A preview answer arrived. An answer for a row the reader has already left is DROPPED: it would
 * otherwise paint one row's diff under another row's heading.
 */
export function previewArrived(state: PendingState, id: string, view: PreviewView): PendingState {
  return state.open === id ? { ...state, preview: view } : state
}

/** The first load, or a refresh after a decision: back to loading, keeping no stale rows. */
export function loading(state: PendingState): PendingState {
  return { ...state, view: { kind: 'loading' } }
}

/**
 * A list arrived. An empty list is its OWN state — the reader is told the window is clear rather than
 * being shown the same line a slow answer shows.
 */
export function loaded(state: PendingState, rows: readonly PendingRow[]): PendingState {
  return { ...state, view: rows.length === 0 ? { kind: 'empty' } : { kind: 'ready', rows } }
}

/** The list could not be read: the reason stays on screen next to a retry control. */
export function failed(state: PendingState, message: string): PendingState {
  return { ...state, view: { kind: 'failed', message } }
}

/** Mark one record as having an action in flight (its buttons are disabled until it ends). */
export function beginAction(state: PendingState, id: string): PendingState {
  return state.busy.includes(id) ? state : { ...state, busy: [...state.busy, id] }
}

/** The action ended, whatever it answered. */
export function endAction(state: PendingState, id: string): PendingState {
  return { ...state, busy: state.busy.filter(candidate => candidate !== id) }
}

/** One refusal or failure line under the list; `null` clears it (a later success does). */
export function noticed(state: PendingState, message: string | null): PendingState {
  return { ...state, notice: message }
}
