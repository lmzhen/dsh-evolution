/**
 * Pure merge transition table. No io, no run shell, no subagents.
 *
 * Every transition returns the whole next row (or a drop), so the caller can persist it
 * through mutateMergeState in one transaction. Invalid transitions are refused by name;
 * a caller never "repairs" a row by guessing which state the operator meant.
 */
import {
  pairKey,
  queueOf,
  rowIdOf,
  type MergeDecision,
  type MergeFailure,
  type MergeRow,
} from './contracts.ts'

export type MergeEvent =
  | { readonly type: 'candidate'; readonly a: string; readonly b: string; readonly at: string }
  | { readonly type: 'round1-keep'; readonly at: string }
  | { readonly type: 'round1-merge'; readonly approval: 'on' | 'off'; readonly decision?: MergeDecision; readonly at: string }
  | { readonly type: 'round1-fail'; readonly failure: MergeFailure; readonly at: string }
  | { readonly type: 'approve'; readonly runId?: string; readonly at: string }
  | { readonly type: 'reject'; readonly at: string }
  | { readonly type: 'round2-fail'; readonly failure: MergeFailure; readonly at: string }
  | { readonly type: 'round2-success'; readonly unitId?: string; readonly at: string }
  | { readonly type: 'restore'; readonly at: string }
  | { readonly type: 'source-gone'; readonly at: string }
  | { readonly type: 'gate-keep'; readonly a: string; readonly b: string; readonly reason?: string; readonly at: string }

export type TransitionResult =
  | { readonly ok: true; readonly row: MergeRow | null }
  | { readonly ok: false; readonly code: 'invalid-transition'; readonly message: string }

function invalid(event: MergeEvent, state: string | undefined): TransitionResult {
  return {
    ok: false,
    code: 'invalid-transition',
    message: 'cannot apply ' + event.type + ' to ' + (state ?? 'no row'),
  }
}

/** Drop fields that must not survive a transition; optional fields stay absent. */
function base(row: MergeRow, at: string): Omit<MergeRow, 'failure'> {
  return {
    id: row.id,
    pairKey: row.pairKey,
    a: row.a,
    b: row.b,
    state: row.state,
    queue: row.queue,
    createdAt: row.createdAt,
    updatedAt: at,
    ...(row.runId === undefined ? {} : { runId: row.runId }),
    ...(row.unitId === undefined ? {} : { unitId: row.unitId }),
    ...(row.origin === undefined ? {} : { origin: row.origin }),
    ...(row.decision === undefined ? {} : { decision: row.decision }),
    ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
  }
}

function next(row: MergeRow, at: string, state: MergeRow['state'], patch: Partial<MergeRow> = {}): TransitionResult {
  return {
    ok: true,
    row: {
      ...base(row, at),
      state,
      queue: queueOf(state),
      ...patch,
    },
  }
}

export function transition(current: MergeRow | undefined, event: MergeEvent): TransitionResult {
  if (event.type === 'candidate') {
    if (current !== undefined) return { ok: true, row: current }
    const key = pairKey(event.a, event.b)
    return {
      ok: true,
      row: {
        id: rowIdOf(key),
        pairKey: key,
        a: event.a,
        b: event.b,
        state: 'verify',
        queue: 'retry',
        createdAt: event.at,
        updatedAt: event.at,
      },
    }
  }
  if (event.type === 'source-gone') return { ok: true, row: null }
  if (event.type === 'gate-keep') {
    if (current !== undefined) return { ok: true, row: current }
    const key = pairKey(event.a, event.b)
    return {
      ok: true,
      row: {
        id: rowIdOf(key),
        pairKey: key,
        a: event.a,
        b: event.b,
        state: 'skipped',
        queue: 'skipped',
        origin: 'agent',
        createdAt: event.at,
        updatedAt: event.at,
      },
    }
  }
  if (current === undefined) return invalid(event, undefined)
  switch (event.type) {
    case 'round1-keep':
      return current.state === 'verify' ? next(current, event.at, 'skipped', { origin: 'agent' }) : invalid(event, current.state)
    case 'round1-merge':
      if (current.state !== 'verify') return invalid(event, current.state)
      return event.approval === 'on'
        ? next(current, event.at, 'pending', event.decision === undefined ? {} : { decision: event.decision })
        : next(current, event.at, 'fuse', event.decision === undefined ? {} : { decision: event.decision })
    case 'round1-fail':
      return current.state === 'verify'
        ? next(current, event.at, 'verify', { failure: event.failure, attempts: (current.attempts ?? 0) + 1 })
        : invalid(event, current.state)
    case 'approve':
      return current.state === 'pending'
        ? next(current, event.at, 'fuse', { ...(event.runId === undefined ? {} : { runId: event.runId }) })
        : invalid(event, current.state)
    case 'reject':
      return current.state === 'pending' ? next(current, event.at, 'skipped', { origin: 'human' }) : invalid(event, current.state)
    case 'round2-fail':
      return current.state === 'fuse'
        ? next(current, event.at, 'fuse', { failure: event.failure, attempts: (current.attempts ?? 0) + 1 })
        : invalid(event, current.state)
    case 'round2-success':
      return current.state === 'fuse'
        ? { ok: true, row: null }
        : invalid(event, current.state)
    case 'restore':
      return current.state === 'skipped'
        ? next(current, event.at, 'verify')
        : invalid(event, current.state)
  }
}
