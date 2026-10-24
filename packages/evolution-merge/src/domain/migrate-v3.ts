/** Pure v2 -> v3 state mapping. IO/backup lives in the migration runner. */
import type { MergeDecision, MergeFailure } from '../contracts.ts'
import type { FuseRowV3, PendingRowV3, SkippedRowV3, V3Row, VerifyRowV3 } from './row-v3.ts'

interface V2Row {
  readonly id?: unknown; readonly pairKey?: unknown; readonly a?: unknown; readonly b?: unknown
  readonly state?: unknown; readonly queue?: unknown; readonly origin?: unknown; readonly failure?: unknown
  readonly decision?: unknown; readonly sourceRevision?: unknown; readonly targetRevision?: unknown
  readonly runId?: unknown; readonly unitId?: unknown; readonly attempts?: unknown
  readonly stagingRef?: unknown; readonly stagingExpiresAt?: unknown
  readonly target?: { readonly requested?: unknown } | undefined
  readonly reason?: unknown; readonly expired?: unknown
  readonly createdAt?: unknown; readonly updatedAt?: unknown
}
interface V2State { readonly schemaVersion?: unknown; readonly rows?: unknown }

export interface V3State { readonly schemaVersion: 3; readonly rows: readonly V3Row[] }
export interface QuarantinedRow { readonly reason: string; readonly raw: unknown }
export type V3Migration =
  | { readonly ok: true; readonly state: V3State; readonly quarantine: readonly QuarantinedRow[] }
  | { readonly ok: false; readonly code: 'state-migration-blocked'; readonly message: string }

function blocked(message: string): V3Migration { return { ok: false, code: 'state-migration-blocked', message } }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function decisionOf(value: unknown): MergeDecision | undefined { return value !== null && typeof value === 'object' ? value as MergeDecision : undefined }
function failureOf(value: unknown): MergeFailure | undefined { return value !== null && typeof value === 'object' ? value as MergeFailure : undefined }
function originOf(value: unknown): 'agent' | 'human' | 'system' { return value === 'agent' || value === 'human' || value === 'system' ? value : 'system' }

export function migrateV2ToV3(raw: unknown): V3Migration {
  const state = raw as V2State
  if (state === null || typeof state !== 'object' || !Array.isArray(state.rows)) return blocked('v2 state is not {rows[]}')
  if (state.schemaVersion !== 2 && state.schemaVersion !== undefined) return blocked('v2 state schemaVersion is ' + String(state.schemaVersion))
  const rows: V3Row[] = []
  const quarantine: QuarantinedRow[] = []
  for (const value of state.rows as V2Row[]) {
    if (!text(value.id) || !text(value.pairKey) || !text(value.a) || !text(value.b)) { quarantine.push({ reason: 'v2 row identity is incomplete', raw: value }); continue }
    if (!text(value.state) || !text(value.createdAt) || !text(value.updatedAt)) { quarantine.push({ reason: 'v2 row state/timestamps are incomplete', raw: value }); continue }
    const base = { id: value.id, pairKey: value.pairKey, a: value.a, b: value.b, version: 0, createdAt: value.createdAt, updatedAt: value.updatedAt, origin: originOf(value.origin), ...(failureOf(value.failure) === undefined ? {} : { failure: failureOf(value.failure)! }) }
    if (value.state === 'verify') {
      const row: VerifyRowV3 = { ...base, state: 'verify', verifySubState: 'unverified', attempts: typeof value.attempts === 'number' ? value.attempts : 0, ...(text(value.sourceRevision) ? { sourceRevision: value.sourceRevision } : {}) }
      rows.push(row)
      continue
    }
    if (value.state === 'skipped') {
      if (!text(value.reason)) { quarantine.push({ reason: 'skipped row lacks reason', raw: value }); continue }
      const row: SkippedRowV3 = { ...base, state: 'skipped', reason: value.reason, attempts: typeof value.attempts === 'number' ? value.attempts : 0, ...(value.reason === 'expired' && text(value.updatedAt) ? { expiredAt: Date.parse(value.updatedAt) } : {}) }
      rows.push(row)
      continue
    }
    const decision = decisionOf(value.decision)
    if (decision === undefined) { quarantine.push({ reason: 'row lacks decision', raw: value }); continue }
    const targetName = text(value.target?.requested) ? value.target.requested : text(decision.target) ? decision.target : undefined
    if (targetName === undefined) { quarantine.push({ reason: 'row lacks target', raw: value }); continue }
    if (value.state === 'pending') {
      const row: PendingRowV3 = { ...base, state: 'pending', target: targetName, decision, attempts: typeof value.attempts === 'number' ? value.attempts : 0, ...(text(value.targetRevision) ? { targetRevision: value.targetRevision } : {}), ...(text(value.sourceRevision) ? { sourceRevision: value.sourceRevision } : {}), ...(value.expired === 'target-taken' || value.expired === 'source-changed' ? { expired: value.expired } : {}) }
      rows.push(row)
      continue
    }
    if (value.state === 'approved') {
      rows.push({ ...base, state: 'approved', target: targetName, decision, attempts: typeof value.attempts === 'number' ? value.attempts : 0, ...(text(value.sourceRevision) ? { sourceRevision: value.sourceRevision } : {}), ...(text(value.runId) ? { runId: value.runId } : {}) })
      continue
    }
    if (value.state === 'fuse') {
      const staging: FuseRowV3['staging'] = text(value.stagingRef)
        ? typeof value.stagingExpiresAt === 'number' ? { kind: 'present', ref: value.stagingRef, expiresAt: value.stagingExpiresAt } : { kind: 'expired', expiresAt: 0, ref: value.stagingRef }
        : { kind: 'absent' }
      rows.push({ ...base, state: 'fuse', target: targetName, decision, attempts: typeof value.attempts === 'number' ? value.attempts : 0, ...(text(value.sourceRevision) ? { sourceRevision: value.sourceRevision } : {}), ...(text(value.runId) ? { runId: value.runId } : {}), staging })
      continue
    }
    quarantine.push({ reason: 'unknown v2 state: ' + value.state, raw: value })
  }
  return { ok: true, state: { schemaVersion: 3, rows }, quarantine }
}
