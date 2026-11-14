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
