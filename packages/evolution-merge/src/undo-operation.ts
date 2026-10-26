/** Batch 2b undo operation: per-pair preflight, journal, restore, receipt and settlement. */
import type { EvolutionIoLike, UnitEvidenceRecord } from '@deepseek-ai/dsh-evolution-core'
import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import type { CommitReceipt } from './commit-receipt.ts'
import { readCommitReceipts } from './commit-receipt.ts'
import { undoMergeReceipt, type MergeUndoPort } from './undo-merge.ts'
import { writeUndoJournal, type UndoPairState } from './domain/undo-journal.ts'
import { readUndoReceipt, writeUndoReceipt } from './domain/undo-receipt.ts'
import { recordPair } from './domain/pair-index-store.ts'
import { readRunMeta, writeRunMeta } from './domain/run-coordinator.ts'
import { readUnitEvidence } from '@deepseek-ai/dsh-evolution-core'
import { evidenceSha256 as unitEvidenceDigest } from './domain/evidence-hash.ts'

export type UndoErrorCode = 'undo-unavailable-legacy-receipt' | 'undo-evidence-expired' | 'undo-evidence-hash-mismatch' | 'undo-target-drift' | 'undo-source-drift' | 'undo-partial-state' | 'undo-unit-not-committed'
export interface UndoResult { readonly ok: boolean; readonly code?: UndoErrorCode; readonly message: string; readonly undone: readonly string[] }
interface PlanPair { readonly receipt: CommitReceipt; readonly evidence: UnitEvidenceRecord; readonly targetNow: string | null; readonly sourcesNow: Readonly<Record<string, string | null>>; readonly done: boolean; readonly targetDone: boolean; readonly sourcesDone: boolean }

function digest(value: string | null): string | null { return value === null ? null : contentHash(value) }
function sortReceipts(receipts: readonly CommitReceipt[]): readonly CommitReceipt[] {
  const remaining = [...receipts]
  const out: CommitReceipt[] = []
  while (remaining.length > 0) {
    const last = [...remaining].sort((a, b) => {
      if (b.at !== a.at) return b.at - a.at
      if (b.sources.includes(a.target)) return 1
      if (a.sources.includes(b.target)) return -1
      return b.sources.length - a.sources.length
    })[0]!
    out.push(last)
    remaining.splice(remaining.indexOf(last), 1)
  }
  return out
}
async function preflight(io: EvolutionIoLike, home: string, port: MergeUndoPort, receipt: CommitReceipt): Promise<PlanPair | UndoResult> {
  const evidence = await readUnitEvidence(io, home, receipt.unitId)
  if (evidence === null) {
    // A legacy receipt never had evidence to hash. A receipt WITH evidenceSha256 whose unit is
    // gone aged out of the retention window; undo must refuse, never guess (DEC-D11).
    return receipt.evidenceSha256 === undefined
      ? { ok: false, code: 'undo-unavailable-legacy-receipt', message: 'commit evidence is missing; undo unavailable for legacy receipt', undone: [] }
      : { ok: false, code: 'undo-evidence-expired', message: 'commit evidence aged out of the retention window; undo unavailable (fail-closed)', undone: [] }
  }
  const expectedSha = receipt.evidenceSha256 ?? unitEvidenceDigest(evidence)
  if (unitEvidenceDigest(evidence) !== expectedSha) return { ok: false, code: 'undo-evidence-hash-mismatch', message: 'commit receipt evidence hash does not match evidence', undone: [] }
  const targetNow = await port.readSkill(receipt.target)
  const targetAfter = evidence.target.after
  const targetBefore = evidence.target.before
  const targetAllowed = targetNow === targetAfter || (receipt.create ? targetNow === null : targetNow === targetBefore)
  if (!targetAllowed) return { ok: false, code: 'undo-target-drift', message: 'target no longer matches the committed unit', undone: [] }
  const sourcesNow: Record<string, string | null> = {}
  for (const source of evidence.sources) {
    const live = await port.readSkill(source.name)
    sourcesNow[source.name] = live
    if (live !== null && live !== source.before) return { ok: false, code: 'undo-source-drift', message: 'source no longer matches the archived unit: ' + source.name, undone: [] }
  }
  const targetDone = receipt.create ? targetNow === null : targetNow === targetBefore
  const sourcesDone = evidence.sources.every(source => sourcesNow[source.name] === source.before)
  return { receipt, evidence, targetNow, sourcesNow, done: targetDone && sourcesDone, targetDone, sourcesDone }
}
async function settleRun(io: EvolutionIoLike, home: string, runId: string, pairKey: string, allPairs: readonly string[], at: number): Promise<void> {
  const current = await readRunMeta(io, home, runId)
  const previous = current?.undonePairs ?? []
  const undone = [...new Set([...previous, pairKey])]
  const all = allPairs.length > 0 ? allPairs.every(key => undone.includes(key)) : true
  await writeRunMeta(io, home, {
    version: 1, runId, phase: all ? 'undone' : 'settled',
    ...(current?.parentRunId === undefined ? {} : { parentRunId: current.parentRunId }),
    ...(current?.pairCount === undefined ? {} : { pairCount: current.pairCount }),
    ...(current?.approval === undefined ? {} : { approval: current.approval }),
    ...(current?.reportRef === undefined ? {} : { reportRef: current.reportRef }),
    undonePairs: undone,
    ...(all ? { undoneAt: new Date(at).toISOString() } : {}),
    createdAt: current?.createdAt ?? new Date(at).toISOString(), updatedAt: new Date(at).toISOString(),
  })
}
export async function runUndoOperation(options: { readonly io: EvolutionIoLike; readonly home: string; readonly runId: string; readonly port: MergeUndoPort; readonly now: () => number; readonly pairKey?: string; readonly target?: string; readonly finalizeUnit?: (unitId: string) => Promise<{ readonly ok: boolean; readonly message?: string }>; readonly onPhase?: (phase: string, pairKey: string) => void | Promise<void> }): Promise<UndoResult> {
  const runReceipts = (await readCommitReceipts(options.io, options.home)).filter(receipt => (receipt.parentRunId ?? receipt.runId) === options.runId)
  const allPairKeys = runReceipts.map(receipt => receipt.pairKey ?? receipt.unitId)
  const allReceipts = runReceipts.filter(receipt => options.target === undefined || receipt.target === options.target)
  const receipts = options.pairKey === undefined ? allReceipts : allReceipts.filter(receipt => receipt.pairKey === options.pairKey)
  if (receipts.length === 0) return { ok: false, message: 'merge run has no commit receipt: ' + options.runId, undone: [] }
  const pairs: UndoPairState[] = receipts.map(receipt => ({ pairKey: receipt.pairKey ?? receipt.unitId, unitId: receipt.unitId, phase: 'pending' as const }))
  await writeUndoJournal(options.io, options.home, { version: 1, runId: options.runId, phase: 'prepared', pairs, updatedAt: new Date(options.now()).toISOString() })
  const undone: string[] = []
  for (const receipt of sortReceipts(receipts)) {
    const pairKey = receipt.pairKey ?? receipt.unitId
    if (options.finalizeUnit !== undefined) {
      const finalized = await options.finalizeUnit(receipt.unitId)
      if (!finalized.ok) return { ok: false, message: finalized.message ?? 'unit finalize failed', undone }
    }
    const existing = await readUndoReceipt(options.io, options.home, options.runId, pairKey)
    if (existing !== null) {
      await options.onPhase?.('pair-index', pairKey)
      await recordPair(options.io, options.home, { pairKey, runId: options.runId, result: 'undone', target: receipt.target })
      await options.onPhase?.('run-meta', pairKey)
      await settleRun(options.io, options.home, options.runId, pairKey, allPairKeys, options.now())
      undone.push(pairKey); continue
    }
    const checked = await preflight(options.io, options.home, options.port, receipt)
    if ('ok' in checked) return { ...checked, undone }
    if (checked.done) {
      await options.onPhase?.('receipt', pairKey)
    await writeUndoReceipt(options.io, options.home, { version: 1, runId: options.runId, ...(receipt.parentRunId === undefined ? {} : { parentRunId: receipt.parentRunId }), pairKey, unitId: receipt.unitId, evidenceSha256: receipt.evidenceSha256 ?? unitEvidenceDigest(checked.evidence), target: receipt.target, sources: checked.evidence.sources.map(source => source.name), restoredTargetHash: receipt.create ? null : digest(checked.evidence.target.before), restoredSourceHashes: Object.fromEntries(checked.evidence.sources.map(source => [source.name, contentHash(source.before)])), at: options.now() })
      await options.onPhase?.('pair-index', pairKey)
      await recordPair(options.io, options.home, { pairKey, runId: options.runId, result: 'undone', target: receipt.target })
      await options.onPhase?.('run-meta', pairKey)
      await settleRun(options.io, options.home, options.runId, pairKey, allPairKeys, options.now())
      undone.push(pairKey); continue
    }
    if (!checked.targetDone || !checked.sourcesDone) {
      const targetStage = checked.targetDone ? 'skip' : 'restore'
      const sourceStage = checked.sourcesDone ? 'skip' : 'restore'
      if (targetStage === 'skip' && sourceStage === 'skip') { /* unreachable, done */ }
    }
    if (checked.targetDone !== checked.sourcesDone && (checked.targetDone || checked.sourcesDone)) {
      return { ok: false, code: 'undo-partial-state', message: 'undo is partially applied; manual retry required', undone }
    }
    const phase = (next: 'restore-target' | 'restore-source' | 'receipt'): UndoPairState => ({ pairKey, unitId: receipt.unitId, phase: next })
    await writeUndoJournal(options.io, options.home, { version: 1, runId: options.runId, phase: 'running', pairs: pairs.map(pair => pair.pairKey === pairKey ? phase('restore-target') : pair), updatedAt: new Date(options.now()).toISOString() })
    await options.onPhase?.('restore-target', pairKey)
    const executed = await undoMergeReceipt(receipt, options.port)
    if (!executed.ok) return { ok: false, message: executed.message, undone }
    await writeUndoJournal(options.io, options.home, { version: 1, runId: options.runId, phase: 'running', pairs: pairs.map(pair => pair.pairKey === pairKey ? phase('restore-source') : pair), updatedAt: new Date(options.now()).toISOString() })
    await options.onPhase?.('restore-source', pairKey)
    await writeUndoJournal(options.io, options.home, { version: 1, runId: options.runId, phase: 'running', pairs: pairs.map(pair => pair.pairKey === pairKey ? phase('receipt') : pair), updatedAt: new Date(options.now()).toISOString() })
    await options.onPhase?.('receipt', pairKey)
    await writeUndoReceipt(options.io, options.home, { version: 1, runId: options.runId, ...(receipt.parentRunId === undefined ? {} : { parentRunId: receipt.parentRunId }), pairKey, unitId: receipt.unitId, evidenceSha256: receipt.evidenceSha256 ?? unitEvidenceDigest(checked.evidence), target: receipt.target, sources: checked.evidence.sources.map(source => source.name), restoredTargetHash: receipt.create ? null : digest(checked.evidence.target.before), restoredSourceHashes: Object.fromEntries(checked.evidence.sources.map(source => [source.name, contentHash(source.before)])), at: options.now() })
    await options.onPhase?.('pair-index', pairKey)
    await recordPair(options.io, options.home, { pairKey, runId: options.runId, result: 'undone', target: receipt.target })
    await options.onPhase?.('run-meta', pairKey)
    await settleRun(options.io, options.home, options.runId, pairKey, allPairKeys, options.now())
    undone.push(pairKey)
  }
  await writeUndoJournal(options.io, options.home, { version: 1, runId: options.runId, phase: 'settled', pairs: pairs.map(pair => ({ ...pair, phase: 'done' as const })), updatedAt: new Date(options.now()).toISOString() })
  return { ok: true, message: 'undone ' + String(undone.length) + ' pair(s)', undone }
}
