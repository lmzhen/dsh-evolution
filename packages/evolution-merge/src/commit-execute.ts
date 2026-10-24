/**
 * Execute one staged merge: assemble the plan, call the host commit port, then write the
 * receipt. A failed commit returns without a receipt; a landed commit with a failed receipt
 * stays successful and carries a warning.
 */
import type { CommitMergePlan, CommitMergeResult, EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { assembleStagedCommit, type CommitAssemblyPort } from './commit-assembly.ts'
import { writeCommitReceipt, type CommitReceipt } from './commit-receipt.ts'
import { pairKey } from './contracts.ts'
import { writeJournal } from './domain/commit-journal-store.ts'
import { snapshotPath, writeCommitSnapshot } from './commit-snapshot.ts'
import type { UnitTransaction, UnitPlan } from '@deepseek-ai/dsh-evolution-core'

export interface CommitPort extends CommitAssemblyPort {
  /** Transitional G2: when set, commit-execute prefers this over commitMerge. */
  unit?: UnitTransaction
  commitMerge?(plan: CommitMergePlan): Promise<CommitMergeResult>
  readSupportFiles?(name: string): Promise<readonly { readonly path: string; readonly content: string }[]>
}

export interface CommitStagedOptions {
  readonly origin: CommitMergePlan['origin']
  readonly summary: string
  readonly now: () => number
  readonly isBlocked?: (name: string) => boolean | Promise<boolean>
  /** G2 transitional: when present, commit through core UnitTransaction. */
  readonly unit?: UnitTransaction
}

export type CommitStagedResult =
  | {
    readonly ok: true
    readonly plan: CommitMergePlan
    readonly result: CommitMergeResult
    readonly receipt?: CommitReceipt
    readonly warning?: string
  }
  | { readonly ok: false; readonly message: string; readonly plan?: CommitMergePlan }

export async function commitStagedRun(
  io: EvolutionIoLike,
  home: string,
  runId: string,
  port: CommitPort,
  options: CommitStagedOptions,
): Promise<CommitStagedResult> {
  const assembled = await assembleStagedCommit(io, home, runId, port, { origin: options.origin, summary: options.summary })
  if (!assembled.ok) return { ok: false, message: assembled.message }
  if (await options.isBlocked?.(assembled.plan.target) === true) {
    return { ok: false, message: 'target is blocked by curator: ' + assembled.plan.target, plan: assembled.plan }
  }
  const journal = { runId, target: assembled.plan.target, create: !assembled.plan.targetExists, sources: assembled.plan.sources, phase: 'prepared' as const, updatedAt: new Date(options.now()).toISOString() }
  let result: CommitMergeResult
  const transaction = options.unit ?? port.unit
  if (transaction !== undefined) {
    const first = assembled.plan.sources[0] ?? assembled.plan.target
    const unitPlan: UnitPlan = { runId, pairKey: pairKey(assembled.plan.target, first), target: assembled.plan.target, targetExists: assembled.plan.targetExists, sources: assembled.plan.sources, body: assembled.plan.body, supportFiles: assembled.plan.supportFiles, expectedTargetBody: assembled.plan.expectedTargetBody, expectedSourceBodies: assembled.plan.expectedSourceBodies, origin: options.origin, summary: options.summary }
    try { await writeJournal(io, home, journal) } catch { /* compat mirror; unit journal is authority */ }
    const prepared = await transaction.prepare(unitPlan)
    if (!prepared.ok) return { ok: false, message: prepared.message, plan: assembled.plan }
    const committed = await transaction.commit(prepared.prepared)
    if (!committed.ok) { try { await writeJournal(io, home, { ...journal, phase: 'failed', updatedAt: new Date(options.now()).toISOString() }) } catch {} ; return { ok: false, message: committed.message, plan: assembled.plan } }
    result = { ok: true, message: 'merged', unitId: committed.evidence.unitId, archived: committed.evidence.sources.filter(source => source.archived).map(source => source.name), mutations: committed.evidence.mutations }
  } else {
    try { await writeCommitSnapshot(io, home, runId, assembled.plan, options.now(), port) } catch (error) { return { ok: false, message: 'commit snapshot failed; refusing to write: ' + (error instanceof Error ? error.message : String(error)), plan: assembled.plan } }
    try { await writeJournal(io, home, journal) } catch { /* journal is best-effort */ }
    if (port.commitMerge === undefined) return { ok: false, message: 'commit port missing: UnitTransaction or commitMerge required', plan: assembled.plan }
    result = await port.commitMerge(assembled.plan)
  }
  if (!result.ok) {
    try { await writeJournal(io, home, { ...journal, phase: 'failed', updatedAt: new Date(options.now()).toISOString() }) } catch {}
    return { ok: false, message: result.message, plan: assembled.plan }
  }
  const committed = { ...journal, phase: 'committed' as const, updatedAt: new Date(options.now()).toISOString(), ...(result.unitId === undefined ? {} : { unitId: result.unitId }) }
  try { await writeJournal(io, home, committed) } catch {}
  if (result.unitId === undefined) return { ok: true, plan: assembled.plan, result, warning: 'commit landed without a unitId; receipt not written' }
  const receipt: CommitReceipt = {
    runId,
    parentRunId: runId.split('/pairs/')[0] ?? runId,
    unitId: result.unitId,
    target: assembled.plan.target,
    create: !assembled.plan.targetExists,
    sources: assembled.plan.sources,
    ...(assembled.plan.sources[0] === undefined ? {} : { pairKey: pairKey(assembled.plan.target, assembled.plan.sources[0]) }),
    archived: result.archived ?? [],
    at: options.now(),
  }
  try {
    await writeCommitReceipt(io, home, receipt)
    try { await io.remove(snapshotPath(home, runId)) } catch { /* committed journal is the record */ }
    return { ok: true, plan: assembled.plan, result, receipt }
  } catch (error) {
    return {
      ok: true,
      plan: assembled.plan,
      result,
      warning: 'commit landed but receipt write failed: ' + (error instanceof Error ? error.message : String(error)),
    }
  }
}
