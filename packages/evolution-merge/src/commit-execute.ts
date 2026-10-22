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
import { writeCommitSnapshot } from './commit-snapshot.ts'

export interface CommitPort extends CommitAssemblyPort {
  commitMerge(plan: CommitMergePlan): Promise<CommitMergeResult>
}

export interface CommitStagedOptions {
  readonly origin: CommitMergePlan['origin']
  readonly summary: string
  readonly now: () => number
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
  try {
    await writeCommitSnapshot(io, home, runId, assembled.plan, options.now())
  } catch (error) {
    return { ok: false, message: 'commit snapshot failed; refusing to write: ' + (error instanceof Error ? error.message : String(error)), plan: assembled.plan }
  }
  const journal = { runId, target: assembled.plan.target, create: !assembled.plan.targetExists, sources: assembled.plan.sources, phase: 'sources-archived' as const, updatedAt: new Date(options.now()).toISOString() }
  try { await writeJournal(io, home, journal) } catch { /* journal is best-effort; receipt remains the commit record */ }
  const result = await port.commitMerge(assembled.plan)
  if (!result.ok) {
    try { await writeJournal(io, home, { ...journal, updatedAt: new Date(options.now()).toISOString() }) } catch {}
    return { ok: false, message: result.message, plan: assembled.plan }
  }
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
    try { await writeJournal(io, home, { ...journal, unitId: result.unitId, phase: 'committed', updatedAt: new Date(options.now()).toISOString() }) } catch {}
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
