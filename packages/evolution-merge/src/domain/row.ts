/** Pure v2 row transitions for G1 cutover. No IO. */
import { pairKey, rowIdOf } from '../contracts.ts'
import { queueOf, transition as stateTransition, type MergeState } from './state.ts'
import type { MergeDecision, MergeFailure } from '../contracts.ts'

export interface MergeRowV2 {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly state: MergeState
  readonly queue: 'verify' | 'pending' | 'fuse' | 'skipped'
  readonly failure?: MergeFailure
  readonly decision?: MergeDecision
  readonly sourceRevision?: string
  readonly targetRevision?: string
  readonly runId?: string
  readonly unitId?: string
  readonly origin?: 'agent' | 'human' | 'system'
  readonly attempts?: number
  readonly stagingRef?: string
  readonly stagingExpiresAt?: number
  readonly target?: { readonly requested: string; readonly actual?: string; readonly created?: boolean }
  readonly reason?: string
  readonly expired?: 'target-taken' | 'source-changed'
  readonly createdAt: string
  readonly updatedAt: string
}

export type MergeRowEvent =
  | { readonly type: 'candidate'; readonly a: string; readonly b: string; readonly at: string }
  | { readonly type: 'round1-start'; readonly at: string }
  | { readonly type: 'round1-keep'; readonly at: string }
  | { readonly type: 'round1-merge'; readonly approval: 'on' | 'off'; readonly decision?: MergeDecision; readonly stagingRef?: string; readonly stagingExpiresAt?: number; readonly at: string }
  | { readonly type: 'round1-fail'; readonly failure: MergeFailure; readonly at: string }
  | { readonly type: 'approve'; readonly runId?: string; readonly at: string }
  | { readonly type: 'reject'; readonly at: string }
  | { readonly type: 'round2-start'; readonly at: string }
  | { readonly type: 'round2-fail'; readonly failure: MergeFailure; readonly at: string }
  | { readonly type: 'round2-success'; readonly unitId?: string; readonly at: string }
  | { readonly type: 'restore'; readonly at: string }
  | { readonly type: 'discard'; readonly at: string }
  | { readonly type: 'source-gone'; readonly at: string }
  | { readonly type: 'target-taken'; readonly at: string }
  | { readonly type: 'source-changed'; readonly at: string }
  | { readonly type: 'staging-expired'; readonly at: string }
  | { readonly type: 'round2-cancel'; readonly at: string }
  | { readonly type: 'timeout'; readonly at: string }
  | { readonly type: 'cancel'; readonly at: string }
  | { readonly type: 'gate-keep'; readonly a: string; readonly b: string; readonly reason?: string; readonly at: string }

export type RowTransitionResult =
  | { readonly ok: true; readonly row: MergeRowV2 | null }
  | { readonly ok: false; readonly code: 'invalid-transition'; readonly message: string }

function base(row: MergeRowV2, at: string): Omit<MergeRowV2, 'failure'> {
  return {
    id: row.id, pairKey: row.pairKey, a: row.a, b: row.b,
    state: row.state, queue: row.queue, createdAt: row.createdAt, updatedAt: at,
    ...(row.runId === undefined ? {} : { runId: row.runId }),
    ...(row.unitId === undefined ? {} : { unitId: row.unitId }),
    ...(row.origin === undefined ? {} : { origin: row.origin }),
    ...(row.decision === undefined ? {} : { decision: row.decision }),
    ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }),
    ...(row.targetRevision === undefined ? {} : { targetRevision: row.targetRevision }),
    ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
    ...(row.stagingRef === undefined ? {} : { stagingRef: row.stagingRef }),
    ...(row.stagingExpiresAt === undefined ? {} : { stagingExpiresAt: row.stagingExpiresAt }),
    ...(row.expired === undefined ? {} : { expired: row.expired }),
    ...(row.target === undefined ? {} : { target: row.target }),
    ...(row.reason === undefined ? {} : { reason: row.reason }),
  }
}

function next(row: MergeRowV2, at: string, state: MergeState, patch: Partial<MergeRowV2> = {}): RowTransitionResult {
  return { ok: true, row: { ...base(row, at), state, queue: queueOf(state), ...patch } }
}

function invalid(event: MergeRowEvent, state: string | undefined): RowTransitionResult {
  return { ok: false, code: 'invalid-transition', message: 'cannot apply ' + event.type + ' to ' + (state ?? 'no row') }
}

export function transitionRow(current: MergeRowV2 | undefined, event: MergeRowEvent): RowTransitionResult {
  if (event.type === 'candidate') {
    if (current !== undefined) return { ok: true, row: current }
    const key = pairKey(event.a, event.b)
    return { ok: true, row: { id: rowIdOf(key), pairKey: key, a: event.a, b: event.b, state: 'verify', queue: 'verify', createdAt: event.at, updatedAt: event.at } }
  }
  if (event.type === 'source-gone') return { ok: true, row: null }
  if (event.type === 'gate-keep') {
    if (current !== undefined) return { ok: true, row: current }
    const key = pairKey(event.a, event.b)
    return { ok: true, row: { id: rowIdOf(key), pairKey: key, a: event.a, b: event.b, state: 'skipped', queue: 'skipped', origin: 'agent', createdAt: event.at, updatedAt: event.at } }
  }
  if (current === undefined) return invalid(event, undefined)
  if (event.type === 'discard') {
    return current.state === 'pending' || current.state === 'approved' || current.state === 'fuse'
      ? { ok: true, row: null }
      : invalid(event, current.state)
  }
  if (event.type === 'restore') {
    return current.state === 'skipped' ? next(current, event.at, 'verify') : invalid(event, current.state)
  }
  if (event.type === 'target-taken' || event.type === 'source-changed') {
    return current.state === 'pending' || current.state === 'approved' || current.state === 'fuse'
      ? next(current, event.at, current.state, { expired: event.type })
      : invalid(event, current.state)
  }
  if (event.type === 'staging-expired') {
    return current.state === 'fuse' || current.state === 'approved'
      ? next(current, event.at, 'approved')
      : invalid(event, current.state)
  }
  if (event.type === 'round2-cancel' || event.type === 'timeout' || event.type === 'cancel') {
    return current.state === 'fuse' ? next(current, event.at, 'approved') : { ok: true, row: current }
  }

  const mapped = event.type === 'round2-success'
    ? { type: 'round2-merged' as const }
    : event.type === 'round2-fail'
      ? { type: 'round2-fail' as const }
      : event.type === 'round1-merge'
        ? { type: 'round1-merge' as const, approval: event.approval === 'on' }
        : event.type === 'round1-start'
          ? { type: 'round1-start' as const }
          : event.type === 'round2-start'
            ? { type: 'round2-start' as const }
            : event.type === 'round1-keep'
              ? { type: 'round1-keep' as const }
              : event.type === 'round1-fail'
                ? { type: 'round1-fail' as const }
                : event.type === 'approve'
                  ? { type: 'approve' as const }
                  : { type: 'reject' as const }
  if (mapped === undefined) return invalid(event, current.state)
  const moved = stateTransition(current.state, mapped)
  if (!moved.ok) return invalid(event, current.state)
  if (moved.state === null) return { ok: true, row: null }

  const patch: { -readonly [K in keyof MergeRowV2]?: MergeRowV2[K] } = {}
  if (event.type === 'round1-merge') {
    if (event.decision !== undefined) patch.decision = event.decision
    if (event.stagingRef !== undefined) patch.stagingRef = event.stagingRef
    if (event.stagingExpiresAt !== undefined) patch.stagingExpiresAt = event.stagingExpiresAt
  }
  if (event.type === 'approve' && event.runId !== undefined) patch.runId = event.runId
  if (event.type === 'round1-fail' || event.type === 'round2-fail') {
    patch.failure = event.failure
    patch.attempts = (current.attempts ?? 0) + 1
  }
  if (event.type === 'round1-keep') patch.origin = 'agent'
  if (event.type === 'reject') patch.origin = 'human'
  if (event.type === 'round2-success' && event.unitId !== undefined) patch.unitId = event.unitId
  return next(current, event.at, moved.state, patch)
}
