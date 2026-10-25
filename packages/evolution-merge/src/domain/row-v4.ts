/** Batch 1b-2a additive schema4 row types and pure write helpers. */
import type { MergeDecision, MergeFailure, MergeRow } from '../contracts.ts'
import type { V3Row } from './row-v3.ts'

export type RowOriginV4 = 'agent' | 'human' | 'system'
export type VerifySubStateV4 = 'candidate' | 'screened' | 'unverified'
export interface RowBaseV4 {
  readonly id: string
  readonly pairKey: string
  readonly a: string
  readonly b: string
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly origin: RowOriginV4
  readonly failure?: MergeFailure
  readonly runId?: string
}
export interface VerifyRowV4 extends RowBaseV4 { readonly state: 'verify'; readonly verifySubState: VerifySubStateV4; readonly sourceRevision?: string; readonly attempts: number }
export interface PendingRowV4 extends RowBaseV4 { readonly state: 'pending'; readonly target: string; readonly decision: MergeDecision; readonly targetRevision?: string; readonly sourceRevision?: string; readonly promptVersion?: string; readonly promptHash?: string; readonly expired?: 'target-taken' | 'source-changed'; readonly expiredAt?: number; readonly attempts: number }
export interface ApprovedRowV4 extends RowBaseV4 { readonly state: 'approved'; readonly target: string; readonly decision: MergeDecision; readonly sourceRevision?: string; readonly targetRevision?: string; readonly runId?: string; readonly attempts: number }
export interface FuseRowV4 extends RowBaseV4 { readonly state: 'fuse'; readonly target: string; readonly decision: MergeDecision; readonly sourceRevision?: string; readonly targetRevision?: string; readonly runId?: string; readonly attempts: number }
export interface SkippedRowV4 extends RowBaseV4 { readonly state: 'skipped'; readonly reason: string; readonly skipSource?: string; readonly expiredAt?: number; readonly attempts: number }
export type V4Row = VerifyRowV4 | PendingRowV4 | ApprovedRowV4 | FuseRowV4 | SkippedRowV4

export type V4Event =
  | { readonly type: 'verify-passed'; readonly decision: MergeDecision; readonly target: string; readonly sourceRevision?: string; readonly promptVersion?: string; readonly promptHash?: string }
  | { readonly type: 'approved'; readonly runId: string }
  | { readonly type: 'auto-approved'; readonly decision: MergeDecision; readonly target: string; readonly runId?: string }
  | { readonly type: 'staged' }
  | { readonly type: 'committed'; readonly unitId: CommitUnitRef }
  | { readonly type: 'skipped'; readonly reason: string; readonly origin?: RowOriginV4; readonly skipSource?: string }
  | { readonly type: 'mark-skipped-expired'; readonly at: number }
  | { readonly type: 'expired'; readonly kind: 'target-taken' | 'source-changed' }
  | { readonly type: 'failed'; readonly failure: MergeFailure }
  | { readonly type: 'restored' }
  | { readonly type: 'superseded' }

export interface CommitUnitRef {
  readonly unitId: string
  readonly evidenceSha256: string
}
export type V4Transition =
  | { readonly ok: true; readonly row: V4Row | null; readonly version: number }
  | { readonly ok: false; readonly code: 'version-conflict' | 'illegal-transition'; readonly message: string }

export type V4Terminal = 'committed' | 'superseded' | 'restored'
export type V4Write =
  | { readonly kind: 'createVerify'; readonly row: VerifyRowV4 }
  | { readonly kind: 'createSkipped'; readonly row: SkippedRowV4 }
  | { readonly kind: 'transition'; readonly id: string; readonly event: V4Event; readonly expectedVersion: number }
  | { readonly kind: 'remove'; readonly id: string; readonly terminal: V4Terminal; readonly unit?: CommitUnitRef; readonly expectedVersion: number }
export type V4WriteError = 'row-invalid' | 'row-duplicate' | 'row-not-found' | 'version-conflict' | 'illegal-transition'
export type V4WriteResult =
  | { readonly ok: true; readonly rows: readonly V4Row[]; readonly row: V4Row | null }
  | { readonly ok: false; readonly code: V4WriteError; readonly message: string }

function bad(code: V4WriteError, message: string): V4WriteResult { return { ok: false, code, message } }
function conflict(message: string): V4Transition { return { ok: false, code: 'version-conflict', message } }
function illegal(message: string): V4Transition { return { ok: false, code: 'illegal-transition', message } }
function advance<T extends V4Row>(row: T, at: string, patch: Partial<V4Row>): T { return { ...row, ...patch, version: row.version + 1, updatedAt: at } as T }

export function transitionV4(row: V4Row, event: V4Event, expectedVersion: number, at = new Date().toISOString()): V4Transition {
  if (row.version !== expectedVersion) return conflict('expected ' + String(expectedVersion) + ', got ' + String(row.version))
  switch (row.state) {
    case 'verify':
      if (event.type === 'verify-passed') return { ok: true, row: advance(row, at, { state: 'pending', target: event.target, decision: event.decision, ...(event.sourceRevision === undefined ? {} : { sourceRevision: event.sourceRevision }), ...(event.promptVersion === undefined ? {} : { promptVersion: event.promptVersion }), ...(event.promptHash === undefined ? {} : { promptHash: event.promptHash }), attempts: 0 }), version: expectedVersion + 1 }
      if (event.type === 'auto-approved') return { ok: true, row: advance(row, at, { state: 'approved', target: event.target, decision: event.decision, attempts: 0, ...(event.runId === undefined ? {} : { runId: event.runId }) }), version: expectedVersion + 1 }
      if (event.type === 'failed') return { ok: true, row: advance(row, at, { failure: event.failure, attempts: row.attempts + 1 }), version: expectedVersion + 1 }
      if (event.type === 'skipped') return { ok: true, row: advance(row, at, { state: 'skipped', reason: event.reason, attempts: row.attempts, ...(event.skipSource === undefined ? {} : { skipSource: event.skipSource }) }), version: expectedVersion + 1 }
      if (event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return illegal('verify/' + event.type)
    case 'pending':
      if (event.type === 'approved') return { ok: true, row: advance(row, at, { state: 'approved', runId: event.runId }), version: expectedVersion + 1 }
      if (event.type === 'auto-approved') return { ok: true, row: advance(row, at, { state: 'approved', ...(event.runId === undefined ? {} : { runId: event.runId }) }), version: expectedVersion + 1 }
      if (event.type === 'staged') return { ok: true, row: advance(row, at, { state: 'fuse' }), version: expectedVersion + 1 }
      if (event.type === 'skipped') return { ok: true, row: advance(row, at, { state: 'skipped', reason: event.reason, ...(event.origin === undefined ? {} : { origin: event.origin }), ...(event.skipSource === undefined ? {} : { skipSource: event.skipSource }) }), version: expectedVersion + 1 }
      if (event.type === 'expired') return { ok: true, row: advance(row, at, { expired: event.kind }), version: expectedVersion + 1 }
      if (event.type === 'failed') return { ok: true, row: advance(row, at, { failure: event.failure, attempts: row.attempts + 1 }), version: expectedVersion + 1 }
      if (event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return illegal('pending/' + event.type)
    case 'approved':
      if (event.type === 'staged') return { ok: true, row: advance(row, at, { state: 'fuse' }), version: expectedVersion + 1 }
      if (event.type === 'committed') return { ok: true, row: null, version: expectedVersion + 1 }
      if (event.type === 'skipped') return { ok: true, row: advance(row, at, { state: 'skipped', reason: event.reason, ...(event.skipSource === undefined ? {} : { skipSource: event.skipSource }) }), version: expectedVersion + 1 }
      if (event.type === 'failed') return event.failure.retryable
        ? { ok: true, row: advance(row, at, { state: 'fuse', failure: event.failure, attempts: row.attempts + 1 }), version: expectedVersion + 1 }
        : { ok: true, row: advance(row, at, { state: 'skipped', reason: event.failure.code, failure: event.failure, attempts: row.attempts + 1 }), version: expectedVersion + 1 }
      if (event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return illegal('approved/' + event.type)
    case 'fuse':
      if (event.type === 'committed') return { ok: true, row: null, version: expectedVersion + 1 }
      if (event.type === 'skipped') return { ok: true, row: advance(row, at, { state: 'skipped', reason: event.reason, ...(event.skipSource === undefined ? {} : { skipSource: event.skipSource }) }), version: expectedVersion + 1 }
      if (event.type === 'failed') return event.failure.retryable
        ? { ok: true, row: advance(row, at, { state: 'fuse', failure: event.failure, attempts: row.attempts + 1 }), version: expectedVersion + 1 }
        : { ok: true, row: advance(row, at, { state: 'skipped', reason: event.failure.code, failure: event.failure, attempts: row.attempts + 1 }), version: expectedVersion + 1 }
      if (event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      return illegal('fuse/' + event.type)
    case 'skipped':
      if (event.type === 'restored' || event.type === 'superseded') return { ok: true, row: null, version: expectedVersion + 1 }
      if (event.type === 'mark-skipped-expired') return row.expiredAt !== undefined ? { ok: true, row, version: expectedVersion } : { ok: true, row: { ...row, expiredAt: event.at }, version: expectedVersion + 1 }
      return illegal('skipped is terminal')
  }
}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
export function isV4Row(value: unknown): value is V4Row {
  if (!object(value)) return false
  if (!string(value.id) || !string(value.pairKey) || !string(value.a) || !string(value.b) || !number(value.version)) return false
  if (!string(value.createdAt) || !string(value.updatedAt) || (value.origin !== 'agent' && value.origin !== 'human' && value.origin !== 'system')) return false
  if (typeof value.attempts !== 'number') return false
  if (value.state === 'verify') return value.verifySubState === 'candidate' || value.verifySubState === 'screened' || value.verifySubState === 'unverified'
  if (value.state === 'pending' || value.state === 'approved' || value.state === 'fuse') return string(value.target) && object(value.decision)
  if (value.state === 'skipped') return string(value.reason)
  return false
}

export function v3ToV4(row: V3Row): V4Row {
  const base = { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, origin: row.origin, attempts: row.attempts, ...(row.failure === undefined ? {} : { failure: row.failure }), ...(row.runId === undefined ? {} : { runId: row.runId }) }
  if (row.state === 'verify') return { ...base, state: 'verify', verifySubState: row.verifySubState, ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }) }
  if (row.state === 'pending') return { ...base, state: 'pending', target: row.target, decision: row.decision, ...(row.targetRevision === undefined ? {} : { targetRevision: row.targetRevision }), ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }), ...(row.expired === undefined ? {} : { expired: row.expired }) }
  if (row.state === 'approved') return { ...base, state: 'approved', target: row.target, decision: row.decision, ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }), ...(row.runId === undefined ? {} : { runId: row.runId }) }
  if (row.state === 'fuse') return { ...base, state: 'fuse', target: row.target, decision: row.decision, ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }), ...(row.runId === undefined ? {} : { runId: row.runId }) }
  return { ...base, state: 'skipped', reason: row.reason, ...(row.expiredAt === undefined ? {} : { expiredAt: row.expiredAt }) }
}

export function applyV4Write(rows: readonly V4Row[], write: V4Write, at: string): V4WriteResult {
  if (write.kind === 'transition') {
    const index = rows.findIndex(row => row.id === write.id)
    if (index < 0) return bad('row-not-found', 'row not found: ' + write.id)
    const moved = transitionV4(rows[index]!, write.event, write.expectedVersion, at)
    if (!moved.ok) return bad(moved.code, moved.message)
    if (moved.row === null) return { ok: true, rows: rows.filter((_, atIndex) => atIndex !== index), row: null }
    const next = [...rows]; next[index] = moved.row
    return { ok: true, rows: next, row: moved.row }
  }
  if (write.kind === 'remove') {
    const index = rows.findIndex(row => row.id === write.id)
    if (index < 0) return bad('row-not-found', 'row not found: ' + write.id)
    const current = rows[index]!
    if (write.terminal === 'committed' && (write.unit === undefined || write.unit.unitId.length === 0 || write.unit.evidenceSha256.length === 0)) return bad('row-invalid', 'committed remove requires commit evidence')
    const event: V4Event = write.terminal === 'committed' ? { type: 'committed', unitId: write.unit! } : { type: write.terminal }
    const moved = transitionV4(current, event, write.expectedVersion, at)
    if (!moved.ok) return bad(moved.code, moved.message)
    return moved.row === null ? { ok: true, rows: rows.filter((_, atIndex) => atIndex !== index), row: null } : { ok: true, rows: rows.map((row, atIndex) => atIndex === index ? moved.row! : row), row: moved.row }
  }
  if (write.row.version !== 0) return bad('row-invalid', 'create requires version 0')
  if (write.kind === 'createVerify' && (write.row.state !== 'verify' || write.row.verifySubState !== 'unverified')) return bad('row-invalid', 'createVerify requires verify/unverified')
  if (write.kind === 'createSkipped' && write.row.state !== 'skipped') return bad('row-invalid', 'createSkipped requires skipped')
  if (!isV4Row(write.row)) return bad('row-invalid', 'created row is invalid')
  if (rows.some(row => row.id === write.row.id)) return bad('row-duplicate', 'duplicate row id: ' + write.row.id)
  return { ok: true, rows: [...rows, write.row], row: write.row }
}

export function v4ToLegacy(row: V4Row): MergeRow {
  const queue = row.state === 'verify' ? 'verify' as const : row.state === 'pending' ? 'pending' as const : row.state === 'skipped' ? 'skipped' as const : 'fuse' as const
  const target = row.state === 'pending' || row.state === 'approved' || row.state === 'fuse' ? { requested: row.target } : undefined
  return {
    id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, state: row.state, queue,
    ...(row.state === 'skipped' ? { reason: row.reason } : {}),
    ...(target === undefined ? {} : { target }),
    ...(row.failure === undefined ? {} : { failure: row.failure }),
    ...(row.state === 'pending' || row.state === 'approved' || row.state === 'fuse' ? { decision: row.decision } : {}),
    ...((row.state === 'pending' || row.state === 'approved' || row.state === 'fuse') && row.sourceRevision !== undefined ? { sourceRevision: row.sourceRevision } : {}),
    ...((row.state === 'pending' || row.state === 'approved' || row.state === 'fuse') && row.targetRevision !== undefined ? { targetRevision: row.targetRevision } : {}),
    ...(row.runId === undefined ? {} : { runId: row.runId }),
    ...(row.origin === undefined ? {} : { origin: row.origin }),
    ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}
