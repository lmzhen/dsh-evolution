/** Pure unit-of-work protocol: intent -> applied -> committed, with recovery states. */
import type { CommitReceipt } from './model.ts'

export type UnitState = 'planned' | 'prepared' | 'applied' | 'committed' | 'aborted' | 'blocked'

export interface UnitSnapshot {
  readonly unitId: string
  readonly state: UnitState
  readonly version: number
  readonly planHash: string
  readonly receipt?: CommitReceipt
  readonly reason?: string
}

export type UnitEvent =
  | { readonly type: 'prepare'; readonly planHash: string }
  | { readonly type: 'applied' }
  | { readonly type: 'commit'; readonly receipt: CommitReceipt }
  | { readonly type: 'abort'; readonly reason: string }
  | { readonly type: 'block'; readonly reason: string }
  | { readonly type: 'recover-commit'; readonly receipt: CommitReceipt }
  | { readonly type: 'recover-abort'; readonly reason: string }

export type UnitTransition =
  | { readonly ok: true; readonly snapshot: UnitSnapshot }
  | { readonly ok: false; readonly code: 'illegal-transition' | 'version-conflict' | 'invalid-event'; readonly message: string }

function fail(code: 'illegal-transition' | 'version-conflict' | 'invalid-event', message: string): UnitTransition {
  return { ok: false, code, message }
}

function next(snapshot: UnitSnapshot, state: UnitState, patch: Partial<UnitSnapshot> = {}): UnitSnapshot {
  return { ...snapshot, state, version: snapshot.version + 1, ...patch }
}

export function transitionUnit(snapshot: UnitSnapshot, event: UnitEvent, expectedVersion: number): UnitTransition {
  if (snapshot.version !== expectedVersion) return fail('version-conflict', 'expected ' + String(expectedVersion) + ', got ' + String(snapshot.version))
  switch (event.type) {
    case 'prepare':
      if (snapshot.state !== 'planned') return fail('illegal-transition', 'prepare from ' + snapshot.state)
      if (event.planHash.length === 0) return fail('invalid-event', 'planHash is required')
      return { ok: true, snapshot: next(snapshot, 'prepared', { planHash: event.planHash }) }
    case 'applied':
      return snapshot.state === 'prepared' ? { ok: true, snapshot: next(snapshot, 'applied') } : fail('illegal-transition', 'applied from ' + snapshot.state)
    case 'commit':
      if (snapshot.state !== 'applied') return fail('illegal-transition', 'commit from ' + snapshot.state)
      if (event.receipt.unitId.length === 0) return fail('invalid-event', 'receipt.unitId is required')
      return { ok: true, snapshot: next(snapshot, 'committed', { receipt: event.receipt }) }
    case 'abort':
      return snapshot.state === 'planned' || snapshot.state === 'prepared' || snapshot.state === 'applied'
        ? { ok: true, snapshot: next(snapshot, 'aborted', { reason: event.reason }) }
        : fail('illegal-transition', 'abort from ' + snapshot.state)
    case 'block':
      return snapshot.state === 'prepared' || snapshot.state === 'applied'
        ? { ok: true, snapshot: next(snapshot, 'blocked', { reason: event.reason }) }
        : fail('illegal-transition', 'block from ' + snapshot.state)
    case 'recover-commit':
      if (snapshot.state !== 'blocked') return fail('illegal-transition', 'recover-commit from ' + snapshot.state)
      return { ok: true, snapshot: next(snapshot, 'committed', { receipt: event.receipt }) }
    case 'recover-abort':
      return snapshot.state === 'blocked'
        ? { ok: true, snapshot: next(snapshot, 'aborted', { reason: event.reason }) }
        : fail('illegal-transition', 'recover-abort from ' + snapshot.state)
    default:
      return fail('invalid-event', 'unknown unit event')
  }
}

export function checkUnit(snapshot: UnitSnapshot): string[] {
  const problems: string[] = []
  if (snapshot.unitId.length === 0) problems.push('unitId is empty')
  if (snapshot.planHash.length === 0) problems.push('planHash is empty')
  if (!Number.isInteger(snapshot.version) || snapshot.version < 0) problems.push('version must be a non-negative integer')
  if (snapshot.state === 'committed' && snapshot.receipt === undefined) problems.push('committed requires a receipt')
  if (snapshot.state === 'blocked' && snapshot.reason === undefined) problems.push('blocked requires a reason')
  if (snapshot.state === 'aborted' && snapshot.reason === undefined) problems.push('aborted requires a reason')
  if (snapshot.receipt !== undefined && snapshot.receipt.unitId !== snapshot.unitId) problems.push('receipt.unitId must equal unitId')
  return problems
}
