/**
 * Execute one staged merge: assemble the plan, call the host commit port, then write the
 * receipt. A failed commit returns without a receipt; a landed commit with a failed receipt
 * stays successful and carries a warning.
 */
import type { CommitMergePlan, CommitMergeResult, EvolutionIoLike, SkillLimits } from '@deepseek-ai/dsh-evolution-core'
import { assembleStagedCommit, type CommitAssemblyPort } from './commit-assembly.ts'
import { writeCommitReceipt, type CommitReceipt } from './commit-receipt.ts'
import { pairKey } from './contracts.ts'
import { writeJournal } from './domain/commit-journal-store.ts'
import { evidenceSha256 as digestEvidence } from './domain/evidence-hash.ts'
import { snapshotPath } from './commit-snapshot.ts'
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
  readonly limits?: SkillLimits
  readonly validationPlan?: import('./contracts.ts').MergeValidationPlanRef
  readonly targetRevision?: import('./contracts.ts').RevisionRef
  readonly sourceRevisions?: Readonly<Record<string, import('./contracts.ts').RevisionRef>>
  readonly supportDigest?: string
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
  | { readonly ok: false; readonly message: string; readonly plan?: CommitMergePlan; readonly code?: CommitMergeResult['code'] }

export async function commitStagedRun(
  io: EvolutionIoLike,
  home: string,
  runId: string,
  port: CommitPort,
  options: CommitStagedOptions,
): Promise<CommitStagedResult> {
  const assembled = await assembleStagedCommit(io, home, runId, port, {
    origin: options.origin,
    summary: options.summary,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.targetRevision === undefined ? {} : { targetRevision: options.targetRevision }),
    ...(options.sourceRevisions === undefined ? {} : { sourceRevisions: options.sourceRevisions }),
    ...(options.supportDigest === undefined ? {} : { supportDigest: options.supportDigest }),
  })
  if (!assembled.ok) return { ok: false, message: assembled.message, ...(assembled.code === undefined ? {} : { code: assembled.code }) }
  if (await options.isBlocked?.(assembled.plan.target) === true) {
    return { ok: false, message: 'target is blocked by curator: ' + assembled.plan.target, plan: assembled.plan }
  }
  const journal = { runId, target: assembled.plan.target, create: !assembled.plan.targetExists, sources: assembled.plan.sources, phase: 'prepared' as const, updatedAt: new Date(options.now()).toISOString() }
  let result: CommitMergeResult
  let evidenceSha256: string | undefined
  const transaction = options.unit ?? port.unit ?? legacyUnitAdapter(port, assembled.plan, options, runId)
  if (transaction === undefined) return { ok: false, message: 'commit port missing: UnitTransaction or commitMerge required', plan: assembled.plan }
  {
    const first = assembled.plan.sources[0] ?? assembled.plan.target
    const unitPlan: UnitPlan = { runId, pairKey: pairKey(assembled.plan.target, first), target: assembled.plan.target, targetExists: assembled.plan.targetExists, sources: assembled.plan.sources, body: assembled.plan.body, supportFiles: assembled.plan.supportFiles, expectedTargetBody: assembled.plan.expectedTargetBody, expectedSourceBodies: assembled.plan.expectedSourceBodies, origin: options.origin, summary: options.summary, ...(options.limits === undefined ? {} : { skillLimits: options.limits }), ...(options.validationPlan === undefined ? {} : { validationPlan: options.validationPlan }), ...(options.targetRevision === undefined ? {} : { targetRevision: options.targetRevision }), ...(options.sourceRevisions === undefined ? {} : { sourceRevisions: options.sourceRevisions }), ...(options.supportDigest === undefined ? {} : { supportDigest: options.supportDigest }) }
    try { await writeJournal(io, home, journal) } catch { /* compat mirror; unit journal is authority */ }
    const prepared = await transaction.prepare(unitPlan)
    if (!prepared.ok) return { ok: false, message: prepared.message, plan: assembled.plan }
    const committed = await transaction.commit(prepared.prepared)
    if (!committed.ok) { try { await writeJournal(io, home, { ...journal, phase: 'failed', updatedAt: new Date(options.now()).toISOString() }) } catch {} ; return { ok: false, message: committed.message, plan: assembled.plan, ...(committed.code === 'target-changed' || committed.code === 'source-changed' || committed.code === 'support-changed' ? { code: committed.code } : {}) } }
    const unitId = committed.evidence.unitId
    if (committed.evidence.unitId !== prepared.prepared.unitId && !prepared.prepared.unitId.startsWith('legacy:')) return { ok: false, message: 'unit evidence does not match prepared unitId', plan: assembled.plan }
    const finalize = (transaction as { finalize?: (unitId: string) => Promise<{ ok: true; evidence: import('@deepseek-ai/dsh-evolution-core').UnitEvidenceRecord } | { ok: false; message: string }> }).finalize
    if (finalize !== undefined) {
      const finalized = await finalize.call(transaction, unitId)
      if (!finalized.ok) return { ok: false, message: 'unit committed but finalize failed: ' + finalized.message, plan: assembled.plan }
    }
    evidenceSha256 = digestEvidence(committed.evidence)
    result = { ok: true, message: 'merged', unitId, archived: committed.evidence.sources.filter(source => source.archived).map(source => source.name), mutations: committed.evidence.mutations }
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
    ...(evidenceSha256 === undefined ? {} : { evidenceSha256 }),
    ...(options.validationPlan === undefined ? {} : { validationPlan: options.validationPlan }),
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

function legacyUnitAdapter(port: CommitPort, plan: CommitMergePlan, options: CommitStagedOptions, runId: string): UnitTransaction | undefined {
  if (port.commitMerge === undefined) return undefined
  let evidence: import('@deepseek-ai/dsh-evolution-core').UnitEvidenceRecord | undefined
  const unitId = 'legacy:' + plan.target + ':' + String(options.now())
  return {
    async prepare() { return { ok: true as const, prepared: { unitId, planDigest: unitId } } },
    async commit() {
      if (port.commitMerge === undefined) return { ok: false as const, code: 'unit-commit-failed' as const, message: 'commitMerge missing' }
      const result = await port.commitMerge(plan)
      if (!result.ok) return { ok: false as const, code: result.code ?? 'unit-commit-failed' as const, message: result.message }
      const actualUnitId = result.unitId ?? unitId
      evidence = { schemaVersion: 1, unitId: actualUnitId, runId, planDigest: actualUnitId, state: 'complete', target: { before: plan.expectedTargetBody, after: plan.body, supportDigest: '', created: !plan.targetExists }, sources: plan.expectedSourceBodies.map(source => ({ name: source.name, before: source.body, after: null, archived: (result.archived ?? []).includes(source.name), absorbedInto: plan.target })), mutations: result.mutations ?? 0, at: options.now() }
      return { ok: true as const, evidence }
    },
    async verify() { return evidence ?? null },
    async rollback() { return { ok: false as const, code: 'unit-committed' as const, message: 'legacy commit cannot roll back' } },
    async finalize() { return evidence === undefined ? { ok: false as const, code: 'unit-plan-missing' as const, message: 'legacy unit has no evidence' } : { ok: true as const, evidence } },
    async rollForward() { return evidence === undefined ? { ok: false as const, code: 'unit-plan-missing' as const, message: 'legacy unit has no evidence' } : { ok: true as const, evidence } },
    async cancel() { return { ok: false, phase: 'none' as const } },
  }
}
