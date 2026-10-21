/**
 * Execute one staged merge: assemble the plan, call the host commit port, then write the
 * receipt. A failed commit returns without a receipt; a landed commit with a failed receipt
 * stays successful and carries a warning.
 */
import type { CommitMergePlan, CommitMergeResult, EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { assembleStagedCommit, type CommitAssemblyPort } from './commit-assembly.ts'
import { writeCommitReceipt, type CommitReceipt } from './commit-receipt.ts'

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
  const result = await port.commitMerge(assembled.plan)
  if (!result.ok) return { ok: false, message: result.message, plan: assembled.plan }
  if (result.unitId === undefined) return { ok: true, plan: assembled.plan, result, warning: 'commit landed without a unitId; receipt not written' }
  const receipt: CommitReceipt = {
    runId,
    unitId: result.unitId,
    target: assembled.plan.target,
    create: !assembled.plan.targetExists,
    sources: assembled.plan.sources,
    archived: result.archived ?? [],
    at: options.now(),
  }
  try {
    await writeCommitReceipt(io, home, receipt)
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
