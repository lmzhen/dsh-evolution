/** RG0 cross-artifact consistency. Pure; no IO. */
export type RowState = 'verify' | 'pending' | 'approved' | 'fuse' | 'skipped' | 'merged'
export type RunState = 'none' | 'awaiting-approval' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'orphan'
export type StagingState = 'none' | 'cleaned' | 'kept' | 'missing'
export type JournalState = 'none' | 'committing' | 'prepared' | 'committed' | 'rolled-back' | 'failed'
export type EvidenceState = 'none' | 'receipt'

export interface ArtifactState {
  readonly row: RowState
  readonly run: RunState
  readonly staging: StagingState
  readonly journal: JournalState
  readonly evidence: EvidenceState
  readonly activeRuns: number
  readonly hasOwner?: boolean
  readonly recovery?: boolean
}

export interface ConsistencyResult { readonly ok: boolean; readonly reason?: string }

const ALLOWED: readonly ArtifactState[] = [
  { row: 'verify', run: 'none', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0 },
  { row: 'verify', run: 'running', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 1 },
  { row: 'verify', run: 'failed', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0 },
  { row: 'pending', run: 'none', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0 },
  { row: 'pending', run: 'awaiting-approval', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 1 },
  { row: 'approved', run: 'none', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0 },
  { row: 'approved', run: 'running', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 1 },
  { row: 'fuse', run: 'none', staging: 'kept', journal: 'none', evidence: 'none', activeRuns: 0 },
  { row: 'fuse', run: 'running', staging: 'kept', journal: 'none', evidence: 'none', activeRuns: 1 },
  { row: 'fuse', run: 'failed', staging: 'kept', journal: 'none', evidence: 'none', activeRuns: 0 },
  { row: 'fuse', run: 'orphan', staging: 'kept', journal: 'none', evidence: 'none', activeRuns: 0 },
  { row: 'fuse', run: 'none', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0, recovery: true },
  { row: 'fuse', run: 'failed', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0, recovery: true },
  { row: 'fuse', run: 'orphan', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0, recovery: true },
  { row: 'fuse', run: 'running', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 1, recovery: true },
  { row: 'fuse', run: 'none', staging: 'missing', journal: 'none', evidence: 'none', activeRuns: 0, recovery: true },
  { row: 'fuse', run: 'failed', staging: 'missing', journal: 'none', evidence: 'none', activeRuns: 0, recovery: true },
  { row: 'fuse', run: 'orphan', staging: 'missing', journal: 'none', evidence: 'none', activeRuns: 0, recovery: true },
  { row: 'fuse', run: 'running', staging: 'missing', journal: 'none', evidence: 'none', activeRuns: 1, recovery: true },
  { row: 'fuse', run: 'running', staging: 'kept', journal: 'committing', evidence: 'none', activeRuns: 1 },
  { row: 'skipped', run: 'none', staging: 'none', journal: 'none', evidence: 'none', activeRuns: 0 },
  { row: 'merged', run: 'succeeded', staging: 'cleaned', journal: 'committed', evidence: 'receipt', activeRuns: 0 },
  { row: 'merged', run: 'succeeded', staging: 'kept', journal: 'committed', evidence: 'receipt', activeRuns: 0 },
]

function same(a: ArtifactState, b: ArtifactState): boolean {
  return a.row === b.row && a.run === b.run && a.staging === b.staging && a.journal === b.journal
    && a.evidence === b.evidence && a.activeRuns === b.activeRuns
    && (b.recovery ?? false) === (a.recovery ?? false)
}

export function validateArtifacts(state: ArtifactState): ConsistencyResult {
  if (state.activeRuns > 1) return { ok: false, reason: 'multiple-active-runs' }
  if (state.activeRuns > 0 && state.hasOwner === false) return { ok: false, reason: 'active-run-no-owner' }
  if (ALLOWED.some(item => same(state, item))) return { ok: true }
  if (state.row === 'pending' && state.staging !== 'none') return { ok: false, reason: 'pending-staging' }
  if (state.row === 'skipped' && state.run === 'running') return { ok: false, reason: 'skipped-running' }
  if (state.row === 'fuse' && state.staging === 'missing' && state.recovery !== true) return { ok: false, reason: 'fuse-lost-staging' }
  if (state.journal === 'committed' && state.evidence !== 'receipt') return { ok: false, reason: 'committed-no-evidence' }
  if (state.row === 'merged' && state.journal === 'rolled-back') return { ok: false, reason: 'committed-rollback' }
  return { ok: false, reason: 'not-allowed' }
}
