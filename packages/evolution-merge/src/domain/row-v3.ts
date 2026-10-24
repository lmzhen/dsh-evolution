/** G3 v3 row machine (parallel to the v2 row until the schema-3 cutover). */
import type { MergeDecision, MergeFailure } from '../contracts.ts'

export type RowOriginV3 = 'agent' | 'human' | 'system'
export type VerifySubStateV3 = 'candidate' | 'screened' | 'unverified'
export interface RowBaseV3 {
  readonly id: string; readonly pairKey: string; readonly a: string; readonly b: string
  readonly version: number; readonly createdAt: string; readonly updatedAt: string
  readonly origin: RowOriginV3; readonly failure?: MergeFailure; readonly runId?: string
}
export interface VerifyRowV3 extends RowBaseV3 { readonly state: 'verify'; readonly verifySubState: VerifySubStateV3; readonly sourceRevision?: string; readonly attempts: number }
export interface PendingRowV3 extends RowBaseV3 { readonly state: 'pending'; readonly target: string; readonly decision: MergeDecision; readonly targetRevision?: string; readonly sourceRevision?: string; readonly expired?: 'target-taken' | 'source-changed'; readonly attempts: number }
export interface ApprovedRowV3 extends RowBaseV3 { readonly state: 'approved'; readonly target: string; readonly decision: MergeDecision; readonly sourceRevision?: string; readonly runId?: string; readonly attempts: number }
export interface FuseRowV3 extends RowBaseV3 {
  readonly state: 'fuse'; readonly target: string; readonly decision: MergeDecision; readonly sourceRevision?: string
  readonly staging: { readonly kind: 'present'; readonly ref: string; readonly expiresAt: number } | { readonly kind: 'absent' } | { readonly kind: 'expired'; readonly expiresAt: number; readonly ref?: string }
  readonly runId?: string; readonly attempts: number
}
export interface SkippedRowV3 extends RowBaseV3 { readonly state: 'skipped'; readonly reason: string; readonly expiredAt?: number; readonly attempts: number }
export type V3Row = VerifyRowV3 | PendingRowV3 | ApprovedRowV3 | FuseRowV3 | SkippedRowV3
export type V3Event =
  | { readonly type: 'verify-passed'; readonly decision: MergeDecision; readonly target: string; readonly sourceRevision?: string }
  | { readonly type: 'approved'; readonly runId: string }
  | { readonly type: 'auto-approved'; readonly decision: MergeDecision; readonly target: string; readonly runId?: string }
  | { readonly type: 'staged'; readonly ref?: string; readonly expiresAt?: number }
  | { readonly type: 'committed'; readonly unitId: string }
  | { readonly type: 'skipped'; readonly reason: string; readonly origin?: 'agent' | 'human' | 'system' }
  | { readonly type: 'expired'; readonly kind: 'target-taken' | 'source-changed' }
  | { readonly type: 'failed'; readonly failure: MergeFailure }
  | { readonly type: 'restored' }
  | { readonly type: 'superseded' }
export type V3Transition =
  | { readonly ok: true; readonly row: V3Row | null; readonly version: number }
  | { readonly ok: false; readonly code: 'version-conflict' | 'illegal-transition'; readonly message: string }
function bad(code: 'version-conflict' | 'illegal-transition', message: string): V3Transition { return { ok: false, code, message } }
function advance<T extends V3Row>(row: T, at: string, patch: Partial<T>): T { return { ...row, ...patch, version: row.version + 1, updatedAt: at } as T }

export function transitionV3(row: V3Row, event: V3Event, expectedVersion: number, at: string = new Date().toISOString()): V3Transition {
  if (row.version !== expectedVersion) return bad('version-conflict', 'expected ' + String(expectedVersion) + ', got ' + String(row.version))
  switch (row.state) {
    case 'verify':
      if (event.type === 'verify-passed') return { ok: true, row: advance(row, at, { state: 'pending', target: event.target, decision: event.decision, sourceRevision: event.sourceRevision, attempts: 0 } as unknown as Partial<VerifyRowV3>), version: expectedVersion + 1 }
      if (event.type === 'auto-approved') return { ok: true, row: advance(row, at, { state: 'approved', target: event.target, decision: event.decision, attempts: 0, ...(event.runId === undefined ? {} : { runId: event.runId }) } as unknown as Partial<VerifyRowV3>), version: expectedVersion + 1 }
      if (event.type === 'failed') return { ok: true, row: advance(row, at, { failure: event.failure, attempts: row.attempts + 1 }), version: expectedVersion + 1 }
      if (event.type === 'skipped') return { ok: true, row: advance(row, at, { state: 'skipped', reason: event.reason, attempts: row.attempts } as unknown as Partial<VerifyRowV3>), version: expectedVersion + 1 }
      if (event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return bad('illegal-transition', 'verify/' + event.type)
    case 'pending':
      if (event.type === 'approved') return { ok: true, row: advance(row, at, { state: 'approved', runId: event.runId } as unknown as Partial<PendingRowV3>), version: expectedVersion + 1 }
      if (event.type === 'auto-approved') return { ok: true, row: advance(row, at, { state: 'approved', ...(event.runId === undefined ? {} : { runId: event.runId }) } as unknown as Partial<PendingRowV3>), version: expectedVersion + 1 }
      if (event.type === 'staged') return { ok: true, row: advance(row, at, { state: 'fuse', staging: event.ref === undefined ? { kind: 'absent' as const } : { kind: 'present' as const, ref: event.ref, expiresAt: event.expiresAt ?? Date.now() + 7 * 86_400_000 } } as unknown as Partial<PendingRowV3>), version: expectedVersion + 1 }
      if (event.type === 'skipped') return { ok: true, row: advance(row, at, { state: 'skipped', reason: event.reason, ...(event.origin === undefined ? {} : { origin: event.origin }) } as unknown as Partial<PendingRowV3>), version: expectedVersion + 1 }
      if (event.type === 'expired') return { ok: true, row: advance(row, at, { expired: event.kind }), version: expectedVersion + 1 }
      if (event.type === 'failed') return { ok: true, row: advance(row, at, { failure: event.failure, attempts: row.attempts + 1 }), version: expectedVersion + 1 }
      if (event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return bad('illegal-transition', 'pending/' + event.type)
    case 'approved':
      if (event.type === 'staged') return { ok: true, row: advance(row, at, { state: 'fuse', staging: event.ref === undefined ? { kind: 'absent' as const } : { kind: 'present' as const, ref: event.ref, expiresAt: event.expiresAt ?? Date.now() + 7 * 86_400_000 } } as unknown as Partial<ApprovedRowV3>), version: expectedVersion + 1 }
      if (event.type === 'committed') return { ok: true, row: null, version: expectedVersion + 1 }
      if (event.type === 'skipped') return { ok: true, row: advance(row, at, { state: 'skipped', reason: event.reason } as unknown as Partial<ApprovedRowV3>), version: expectedVersion + 1 }
      if (event.type === 'failed') return event.failure.retryable
        ? { ok: true, row: advance(row, at, { state: 'pending', failure: event.failure, attempts: row.attempts + 1 } as unknown as Partial<ApprovedRowV3>), version: expectedVersion + 1 }
        : { ok: true, row: advance(row, at, { state: 'skipped', reason: event.failure.code, failure: event.failure, attempts: row.attempts + 1 } as unknown as Partial<ApprovedRowV3>), version: expectedVersion + 1 }
      if (event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return bad('illegal-transition', 'approved/' + event.type)
    case 'fuse':
      if (event.type === 'staged') return { ok: true, row: advance(row, at, { staging: event.ref === undefined ? { kind: 'absent' as const } : { kind: 'present' as const, ref: event.ref, expiresAt: event.expiresAt ?? Date.now() + 7 * 86_400_000 } }), version: expectedVersion + 1 }
      if (event.type === 'committed') return { ok: true, row: null, version: expectedVersion + 1 }
      if (event.type === 'skipped') return { ok: true, row: advance(row, at, { state: 'skipped', reason: event.reason } as unknown as Partial<FuseRowV3>), version: expectedVersion + 1 }
      if (event.type === 'failed') return event.failure.retryable
        ? { ok: true, row: advance(row, at, { state: 'pending', failure: event.failure, attempts: row.attempts + 1 } as unknown as Partial<FuseRowV3>), version: expectedVersion + 1 }
        : { ok: true, row: advance(row, at, { state: 'skipped', reason: event.failure.code, failure: event.failure, attempts: row.attempts + 1 } as unknown as Partial<FuseRowV3>), version: expectedVersion + 1 }
      if (event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return bad('illegal-transition', 'fuse/' + event.type)
    case 'skipped':
      if (event.type === 'restored' || event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return bad('illegal-transition', 'skipped is terminal')
  }
}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

/** Runtime validation for a persisted v3 row. */
export function isV3Row(value: unknown): value is V3Row {
  if (!object(value)) return false
  if (!string(value.id) || !string(value.pairKey) || !string(value.a) || !string(value.b) || !number(value.version)) return false
  if (!string(value.createdAt) || !string(value.updatedAt)) return false
  if (value.origin !== 'agent' && value.origin !== 'human' && value.origin !== 'system') return false
  if (value.failure !== undefined && !object(value.failure)) return false
  if (!number(value.attempts)) return false
  switch (value.state) {
    case 'verify':
      return value.verifySubState === 'candidate' || value.verifySubState === 'screened' || value.verifySubState === 'unverified'
    case 'pending':
      return string(value.target) && object(value.decision)
    case 'approved':
      return string(value.target) && object(value.decision)
    case 'fuse':
      if (!string(value.target) || !object(value.decision) || !object(value.staging)) return false
      if (value.staging.kind === 'present') return string(value.staging.ref) && number(value.staging.expiresAt)
      if (value.staging.kind === 'expired') return number(value.staging.expiresAt)
      return value.staging.kind === 'absent'
    case 'skipped':
      return string(value.reason)
    default:
      return false
  }
}
