/** Post-recovery projection: evidence -> report -> row remove -> stage drop -> settle/meta. */
import type { EvolutionIoLike, UnitEvidenceRecord } from '@deepseek-ai/dsh-evolution-core'
import { readCommitReceipts, writeCommitReceipt } from './commit-receipt.ts'
import { mergeReportPath, readMergeReport, writeMergeReport } from './report.ts'
import { pairLedger, readPairLedgerV4 } from './domain/pair-ledger.ts'
import { readAllStages, readStageTree, writeStageIndex } from './domain/stage-aggregate.ts'
import { dropStage } from './domain/stage-aggregate.ts'
import { recordPair } from './domain/pair-index-store.ts'
import { readRunMeta, writeRunMeta } from './domain/run-coordinator.ts'
import { evidenceSha256 } from './domain/evidence-hash.ts'
import type { MergeReport } from './contracts.ts'

export interface ProjectionResult { readonly ok: boolean; readonly action: string; readonly message?: string; readonly reportPath?: string }
export async function projectRecoveredUnit(options: {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly unitId: string
  readonly evidence: UnitEvidenceRecord
  readonly now: () => number
  /** Branch D: the unit committed, but the run was interrupted by process death. */
  readonly interrupted?: boolean
  readonly runs?: {
    settle(id: string, outcome: { state: 'succeeded' | 'failed' | 'cancelled' | 'interrupted'; resultRef?: string; failure?: string }): Promise<void>
    /** Controlled orphan upgrade: lets a committed unit turn failed(orphan) back into succeeded. */
    settleRecovered?(id: string, outcome: { state: 'succeeded' | 'failed' | 'cancelled' | 'interrupted'; resultRef?: string; failure?: string }): Promise<boolean>
  }
  readonly onPhase?: (phase: string) => void | Promise<void>
}): Promise<ProjectionResult> {
  const evidenceSha = evidenceSha256(options.evidence)
  const ledger = await readPairLedgerV4(options.io, options.home).catch(() => null)
  const row = ledger?.rows.find(item => item.runId === options.runId && (item.state === 'fuse' || item.state === 'approved'))
  const rowTarget = row !== undefined && 'target' in row && typeof row.target === 'string' ? row.target : undefined
  const rowDecisionTarget = row !== undefined && 'decision' in row ? row.decision.target : undefined
  const target = rowTarget ?? rowDecisionTarget ?? options.evidence.sources[0]?.absorbedInto ?? options.evidence.target.after
  const pairKey = row?.pairKey ?? target + '\u0000' + (options.evidence.sources[0]?.name ?? '')
  const expectedPairKey = pairKey
  const stageEntry = (await readAllStages(options.io, options.home)).find(item => item.rowId === row?.id || item.pairKey === expectedPairKey)
  const stageRowId = row?.id ?? stageEntry?.rowId
  if (row?.state === 'approved' && stageEntry?.state === 'reserved') {
    const tree = await readStageTree(options.io, options.home, stageEntry.ref)
    if (tree.kind !== 'present') {
      await writeStageIndex(options.io, options.home, { ...stageEntry, state: 'lost' })
      return { ok: false, action: 'stage-lost', message: 'approved+reserved has no stage tree' }
    }
  }
  const receipts = await readCommitReceipts(options.io, options.home)
  const receipt = receipts.find(item => item.unitId === options.unitId)
  const evidencePlan = (options.evidence as typeof options.evidence & { validationPlan?: { readonly planVersion: 1; readonly stageDigest: string; readonly revision: string } }).validationPlan
  const validationPlan = receipt?.validationPlan ?? evidencePlan
  if (receipt === undefined) {
    await options.onPhase?.('merge-receipt')
    await writeCommitReceipt(options.io, options.home, {
      runId: options.runId, unitId: options.unitId, evidenceSha256: evidenceSha,
      target, create: options.evidence.target.created,
      sources: options.evidence.sources.map(source => source.name),
      archived: options.evidence.sources.filter(source => source.archived).map(source => source.name),
      pairKey, at: options.now(),
      ...(validationPlan === undefined ? {} : { validationPlan }),
    })
  }
  const at = options.now()
  let reportPath: string
  const existing = await readMergeReport(options.io, options.home, options.runId)
  if (existing.kind === 'present') {
    reportPath = mergeReportPath(options.home, options.runId)
    if (validationPlan !== undefined && existing.value.pairs.every(pair => pair.validationPlan === undefined)) {
      await writeMergeReport(options.io, options.home, { ...existing.value, pairs: existing.value.pairs.map(pair => ({ ...pair, validationPlan })) })
    }
  }
  else {
    const report: MergeReport = {
      schemaVersion: 2, runId: options.runId, kind: 'merge', command: 'approve', startedAt: at, endedAt: at,
      stopReason: options.interrupted === true ? 'interrupted' : 'completed', approval: { platformWrite: false, mergeApproval: true },
      scope: { candidatePairs: 1, queueBefore: { verify: 0, pending: 0, fuse: 0, skipped: 0 } },
      pairs: [{ id: row?.id ?? options.unitId, pairKey, a: row?.a ?? target, b: row?.b ?? options.evidence.sources[0]?.name ?? '', queue: 'fuse', outcome: 'merged', archived: options.evidence.sources.filter(source => source.archived).map(source => source.name), unitId: options.unitId, ...(validationPlan === undefined ? {} : { validationPlan }) }],
      totals: { merged: 1, kept: 0, pending: 0, failed: 0 }, notes: ['recovered from unit journal'],
    }
    await options.onPhase?.('report')
    try { reportPath = await writeMergeReport(options.io, options.home, report) } catch (error) { return { ok: false, action: 'report-write-failed', message: error instanceof Error ? error.message : String(error) } }
  }
  if (row !== undefined) {
    await options.onPhase?.('row-remove')
    const removed = await pairLedger(options.io, options.home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      return current === undefined ? true : tx.remove(row.id, 'committed', { unitId: options.unitId, evidenceSha256: evidenceSha }, current.version).ok
    })
    if (!removed) return { ok: false, action: 'row-remove-failed' }
    await options.onPhase?.('stage-drop')
    await dropStage(options.io, options.home, row.id)
  } else if (stageRowId !== undefined) {
    await options.onPhase?.('stage-drop')
    await dropStage(options.io, options.home, stageRowId)
  }
  await options.onPhase?.('pair-index')
  await recordPair(options.io, options.home, { pairKey, runId: options.runId, result: 'merged', target })
  await options.onPhase?.('run-meta')
  const meta = await readRunMeta(options.io, options.home, options.runId)
  await writeRunMeta(options.io, options.home, { version: 1, runId: options.runId, ...(meta?.pid === undefined ? {} : { pid: meta.pid }), phase: 'settled', ...(options.interrupted === true ? { stopReason: 'interrupted' } : {}), reportRef: reportPath, pairCount: 1, ...(meta?.parentRunId === undefined ? {} : { parentRunId: meta.parentRunId }), ...(meta?.stagingRef === undefined ? {} : { stagingRef: meta.stagingRef }), ...(meta?.pairs === undefined ? {} : { pairs: meta.pairs }), createdAt: meta?.createdAt ?? new Date(at).toISOString(), updatedAt: new Date(at).toISOString() })
  await options.onPhase?.('settle')
  if (options.runs !== undefined) {
    const outcome = { state: options.interrupted === true ? 'interrupted' as const : 'succeeded' as const, resultRef: reportPath }
    const upgraded = options.runs.settleRecovered === undefined ? false : await options.runs.settleRecovered(options.runId, outcome)
    if (!upgraded) await options.runs.settle(options.runId, outcome)
  }
  return { ok: true, action: 'projected', reportPath }
}
