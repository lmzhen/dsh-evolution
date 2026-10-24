/** Temporary v3 <-> legacy projection while commands still consume the flat row. */
import type { MergeRowV2 } from './row.ts'
import type { V3Row } from './row-v3.ts'

export function v3ToLegacy(row: V3Row): MergeRowV2 {
  const common = {
    id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, state: row.state,
    queue: row.state === 'verify' ? 'verify' as const : row.state === 'pending' ? 'pending' as const : row.state === 'skipped' ? 'skipped' as const : 'fuse' as const,
    version: row.version, origin: row.origin, ...(row.runId === undefined ? {} : { runId: row.runId }),
    ...(row.failure === undefined ? {} : { failure: row.failure }),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
  if (row.state === 'verify') return { ...common, ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }), attempts: row.attempts }
  if (row.state === 'skipped') return { ...common, reason: row.reason, queue: 'skipped' as const, ...(row.expiredAt === undefined ? {} : { expired: 'target-taken' as const }), attempts: row.attempts }
  const target = { requested: row.target, ...(row.state === 'fuse' ? { actual: row.target } : {}) }
  if (row.state === 'fuse') {
    return {
      ...common, target, decision: row.decision, attempts: row.attempts,
      ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }),
      ...(row.runId === undefined ? {} : { runId: row.runId }),
      ...(row.staging.kind === 'present' ? { stagingRef: row.staging.ref, stagingExpiresAt: row.staging.expiresAt } : row.staging.kind === 'expired' ? { stagingExpiresAt: row.staging.expiresAt, ...(row.staging.ref === undefined ? {} : { stagingRef: row.staging.ref }) } : {}),
    }
  }
  return {
    ...common, target, decision: row.decision, attempts: row.attempts,
    ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }),
    ...(row.state === 'pending' && row.targetRevision !== undefined ? { targetRevision: row.targetRevision } : {}),
    ...(row.state === 'pending' && row.expired !== undefined ? { expired: row.expired } : {}),
    ...(row.state === 'approved' && row.runId !== undefined ? { runId: row.runId } : {}),
  }
}

export function legacyToV3(row: MergeRowV2): V3Row | null {
  const base = { id: row.id, pairKey: row.pairKey, a: row.a, b: row.b, version: row.version ?? 0, createdAt: row.createdAt, updatedAt: row.updatedAt, origin: row.origin ?? 'system', ...(row.runId === undefined ? {} : { runId: row.runId }), ...(row.failure === undefined ? {} : { failure: row.failure }) }
  if (row.state === 'verify') return { ...base, state: 'verify', verifySubState: 'unverified', attempts: row.attempts ?? 0, ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }) }
  if (row.state === 'skipped') return { ...base, state: 'skipped', reason: row.reason ?? 'skipped', attempts: row.attempts ?? 0 }
  const targetName = row.target?.requested ?? row.a
  const decision = row.decision ?? { shouldMerge: false, mode: 'keep' as const, target: targetName, sources: [row.b], rationale: 'legacy row without decision' }
  if (row.state === 'pending') return { ...base, state: 'pending', target: targetName, decision, attempts: row.attempts ?? 0, ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }), ...(row.targetRevision === undefined ? {} : { targetRevision: row.targetRevision }), ...(row.expired === undefined ? {} : { expired: row.expired }) }
  if (row.state === 'approved') return { ...base, state: 'approved', target: targetName, decision, attempts: row.attempts ?? 0, ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }), ...(row.runId === undefined ? {} : { runId: row.runId }) }
  const staging = row.stagingRef !== undefined
    ? row.stagingExpiresAt !== undefined ? { kind: 'present' as const, ref: row.stagingRef, expiresAt: row.stagingExpiresAt } : { kind: 'expired' as const, expiresAt: 0 }
    : { kind: 'absent' as const }
  return { ...base, state: 'fuse', target: targetName, decision, attempts: row.attempts ?? 0, ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }), ...(row.runId === undefined ? {} : { runId: row.runId }), staging }
}
