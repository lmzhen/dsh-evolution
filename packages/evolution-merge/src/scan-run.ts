/**
 * The scan pair loop. Registry/report lifecycle stays in withMergeRun; this module owns
 * candidate → round1 → pending/fuse → commit transitions and returns the report draft.
 */
import {
  pairKey,
  rowIdOf,
  queueOf,
  type MergeCandidate,
  type MergeDecision,
  type MergeCriteria,
  type MergeFailure,
  type MergeValidationIssue,
  type MergeReportPair,
  type MergeRow,
} from './contracts.ts'
import { loadMergeState } from './state.ts'
import { pairLedger } from './domain/pair-ledger.ts'
import { presentStage, dropStage, type StageEntry } from './domain/stage-aggregate.ts'
import { recordPair } from './domain/run-coordinator.ts'
import { v4ToLegacy } from './domain/row-v4.ts'
import type { EvolutionIoLike, RunStage } from '@deepseek-ai/dsh-evolution-core'
import { criteriaFrom } from './domain/engine-criteria.ts'
import type { SkillCard } from './skill-card.ts'
import { withDecisionRevisions } from './revision.ts'
import type { MergeRunReportDraft } from './run-shell.ts'

const isAborted = (signal: AbortSignal): boolean => signal.aborted

export interface ScanRound1Outcome {
  readonly kind: 'keep' | 'merge' | 'failed'
  readonly decision?: MergeDecision
  readonly failure?: MergeFailure
  readonly stagingRef?: string
  readonly stagingExpiresAt?: number
  readonly sourceRevision?: string
  readonly targetRevision?: string
  readonly degraded?: readonly string[]
  readonly usage?: import('./contracts.ts').MergeUsage
}

export interface ScanRound2Outcome {
  readonly kind: 'merged' | 'failed'
  readonly unitId?: string
  readonly evidenceSha256?: string
  readonly validationPlan?: import('./contracts.ts').MergeValidationPlanRef
  readonly manifestFiles?: readonly string[]
  readonly criteria?: import('./contracts.ts').MergeCriteria
  readonly validationIssues?: readonly MergeValidationIssue[]
  readonly archived?: readonly string[]
  readonly target?: { readonly requested: string; readonly actual: string; readonly created: boolean }
  readonly failure?: MergeFailure
  readonly usage?: import('./contracts.ts').MergeUsage
  readonly lengths?: Readonly<Record<string, number>>
}

export interface ScanPorts {
  screening(signal: AbortSignal): Promise<readonly MergeCandidate[]>
  resolve?(candidate: MergeCandidate): Promise<boolean>
  round1(candidate: MergeCandidate, signal: AbortSignal): Promise<ScanRound1Outcome>
  stage?(row: MergeRow, decision: MergeDecision): Promise<{ readonly ok: true; readonly entry: StageEntry } | { readonly ok: false; readonly message: string }>
  round2(row: MergeRow, decision: MergeDecision, signal: AbortSignal): Promise<ScanRound2Outcome>
}

export interface RunScanOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly now: () => number
  readonly signal: AbortSignal
  readonly approval: boolean
  readonly timeoutMinutes?: number
  readonly startedAt?: number
  readonly ports: ScanPorts
  readonly stage?: (stage: RunStage, progress?: { done: number; total: number }) => Promise<void>
  readonly notes?: readonly string[]
  readonly runId?: string
  readonly isOwnerActive?: (runId: string) => boolean | Promise<boolean>
  readonly cards?: readonly SkillCard[]
  /** The model identity recorded on pending decisions/summary; absent when the host has none. */
  readonly model?: string
}

function at(now: () => number): string {
  return new Date(now()).toISOString()
}

function failureOf(stage: MergeFailure['stage'], error: unknown): MergeFailure {
  return {
    stage,
    code: 'merge-failed',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    retryFrom: stage === 'decide' ? 'agent1' : 'agent2',
  }
}

function pairCriteria(outcome: MergeReportPair['outcome']): MergeCriteria {
  if (outcome === 'merged') return { decision: 'merge', validation: 'required', commit: 'required', archive: 'sources', evidence: 'receipt' }
  if (outcome === 'kept') return { decision: 'keep', validation: 'report-only', commit: 'never', archive: 'none', evidence: 'none' }
  if (outcome === 'pending') return { decision: 'merge', validation: 'required', commit: 'if-approved', archive: 'none', evidence: 'none' }
  return { decision: 'merge', validation: 'required', commit: 'never', archive: 'none', evidence: 'none' }
}
function pairOf(row: MergeRow, candidate: MergeCandidate, outcome: MergeReportPair['outcome'], extra: Partial<MergeReportPair> = {}): MergeReportPair {
  return {
    id: row.id,
    pairKey: row.pairKey,
    a: row.a,
    b: row.b,
    queue: row.queue,
    candidate,
    ...(candidate.gate === undefined ? {} : { gate: candidate.gate }),
    outcome,
    archived: [],
    criteria: pairCriteria(outcome),
    ...extra,
  }
}

export async function runScan(options: RunScanOptions): Promise<MergeRunReportDraft> {
  const stage = options.stage ?? (async () => {})
  const candidates = await options.ports.screening(options.signal)
  const before = await loadMergeState(options.io, options.home)
  if (!before.ok) throw new Error(before.note ?? 'merge-state-invalid')
  const queueBefore = { verify: 0, pending: 0, fuse: 0, skipped: 0 }
  for (const row of before.state.rows) queueBefore[row.queue] += 1
  const startedAt = options.startedAt ?? options.now()
  const timeoutMs = (options.timeoutMinutes ?? 0) > 0 ? (options.timeoutMinutes as number) * 60_000 : 0
  const pairs: MergeReportPair[] = []
  const degradedNotes: string[] = []
  const totals = { merged: 0, kept: 0, pending: 0, failed: 0 }
  const remaining: { pairKey: string; queue: ReturnType<typeof queueOf> }[] = []
const finalizeRows: { id: string; unitId: string; evidenceSha256: string }[] = []
  let stopReason: MergeRunReportDraft['stopReason'] = 'completed'

  for (let index = 0; index < candidates.length; index += 1) {
    if (isAborted(options.signal)) {
      stopReason = 'cancelled'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'verify' as const })))
      break
    }
    if (timeoutMs > 0 && options.now() - startedAt >= timeoutMs) {
      stopReason = 'timeout'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'verify' as const })))
      break
    }
    const candidate = candidates[index] as MergeCandidate
    await stage('decide', { done: index, total: candidates.length })
    let row: MergeRow
    try {
      const key = pairKey(candidate.a, candidate.b)
      const atNow = at(options.now)
      row = { id: rowIdOf(key), pairKey: key, a: candidate.a, b: candidate.b, state: 'verify', queue: 'verify', createdAt: atNow, updatedAt: atNow, ...(options.runId === undefined ? {} : { runId: options.runId }) }
      const before = (await loadMergeState(options.io, options.home)).state.rows.find(item => item.pairKey === row.pairKey)
      if (before?.state === 'verify' && before.runId !== undefined && before.runId !== options.runId
        && (await options.isOwnerActive?.(before.runId)) === true) {
        continue
      }
      const status = await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.pairKey === row.pairKey)
        if (current !== undefined && current.state !== 'verify' && current.state !== 'skipped') return 'conflict:' + current.state
        if (current?.state === 'skipped') {
          const removed = tx.transition(current.id, { type: 'restored' }, current.version)
          if (!removed.ok) return 'restore-failed'
        }
        if (current?.state === 'verify') return 'existing'
        const made = tx.createVerify({
          id: current?.id ?? rowIdOf(row.pairKey), pairKey: row.pairKey, a: row.a, b: row.b,
          version: 0, createdAt: at(options.now), updatedAt: at(options.now), origin: 'agent',
          state: 'verify', verifySubState: 'unverified', attempts: 0,
          ...(row.runId === undefined ? {} : { runId: row.runId }),
        })
        return made.ok ? 'created' : 'invalid:' + made.code
      })
      if (status.startsWith('conflict:')) throw new Error('pair already in ' + status.slice(9))
      if (status === 'restore-failed' || status.startsWith('invalid:')) throw new Error('cannot place verify row: ' + status)
    } catch (error) {
      totals.failed += 1
      pairs.push({
        id: '', pairKey: pairKey(candidate.a, candidate.b), a: candidate.a, b: candidate.b, queue: 'verify',
        candidate, outcome: 'failed', archived: [], failure: failureOf('screening', error),
      })
      continue
    }

    if (options.ports.resolve !== undefined && !(await options.ports.resolve(candidate))) {
      await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        return current === undefined ? false : tx.remove(row.id, 'superseded', undefined, current.version).ok
      })
      pairs.push(pairOf(row, candidate, 'failed', { failure: { stage: 'decide', code: 'source-gone', message: 'source skill disappeared before round1', retryable: false, retryFrom: 'none' } }))
      totals.failed += 1
      continue
    }
    let round1: ScanRound1Outcome
    try {
      round1 = await options.ports.round1(candidate, options.signal)
    } catch (error) {
      round1 = { kind: 'failed', failure: failureOf('decide', error) }
    }
    if (isAborted(options.signal)) {
      stopReason = 'cancelled'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'verify' as const })))
      break
    }
    if (round1.kind === 'failed') {
      if (round1.degraded !== undefined) degradedNotes.push(...round1.degraded)
      const failure = round1.failure ?? failureOf('decide', 'round1 failed')
      const projected = await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) return null
        const moved = tx.transition(row.id, { type: 'failed', failure }, current.version)
        return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
      })
      if (projected === null) { pairs.push(pairOf(row, candidate, 'failed', { failure: failureOf('decide', 'row changed before failure record') })); totals.failed += 1; continue }
      row = projected
      pairs.push(pairOf(row, candidate, 'failed', { failure }))
      totals.failed += 1
      continue
    }
    if (round1.kind === 'keep') {
      const projected = await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) return null
        const keepReason = round1.decision?.rationale?.trim()
        const moved = tx.transition(row.id, { type: 'skipped', ...(keepReason === undefined || keepReason === '' ? { reason: 'kept' } : { reason: keepReason }), origin: 'agent' }, current.version)
        return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
      })
      if (projected === null) { pairs.push(pairOf(row, candidate, 'failed', { failure: failureOf('decide', 'row changed before keep record') })); totals.failed += 1; continue }
      row = projected
      await recordPair(options.io, options.home, { pairKey: row.pairKey, runId: row.runId ?? 'merge', result: 'kept' })
      pairs.push(pairOf(row, candidate, 'kept', { ...(round1.decision === undefined ? {} : { decision: round1.decision }), ...(round1.usage === undefined ? {} : { usage: round1.usage }) }))
      totals.kept += 1
      continue
    }
    if (round1.decision === undefined) {
      pairs.push(pairOf(row, candidate, 'failed', { failure: failureOf('decide', 'merge decision missing') }))
      totals.failed += 1
      continue
    }
    const decided = options.model === undefined || round1.decision!.model !== undefined ? round1.decision! : { ...round1.decision!, model: options.model }
    const mergeDecision = options.cards !== undefined ? withDecisionRevisions(decided, options.cards, row.a, row.b) : decided
    if (options.approval) {
      const event = { type: 'verify-passed' as const, decision: mergeDecision, target: mergeDecision.target, ...(round1.sourceRevision === undefined ? {} : { sourceRevision: round1.sourceRevision }), ...(mergeDecision.promptVersion === undefined ? {} : { promptVersion: mergeDecision.promptVersion }), ...(mergeDecision.promptHash === undefined ? {} : { promptHash: mergeDecision.promptHash }) }
      const projected = await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) return null
        const moved = tx.transition(row.id, event, current.version)
        return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
      })
      if (projected === null) { pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: failureOf('decide', 'row changed before pending record') })); totals.failed += 1; continue }
      row = projected
      pairs.push(pairOf(row, candidate, 'pending', { decision: mergeDecision }))
      totals.pending += 1
      continue
    }

    const approved = await pairLedger(options.io, options.home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      if (current === undefined) return null
      const moved = tx.transition(row.id, { type: 'auto-approved', decision: mergeDecision!, target: mergeDecision!.target, ...(row.runId === undefined ? {} : { runId: row.runId }) }, current.version)
      return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
    })
    if (approved === null) {
      pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: failureOf('author', 'row changed before approve record') }))
      totals.failed += 1
      continue
    }
    row = approved
    let stageEntry: StageEntry | undefined
    if (options.ports.stage !== undefined) {
      const staged = await options.ports.stage(row, mergeDecision)
      if (!staged.ok) {
        pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: failureOf('author', staged.message) }))
        totals.failed += 1
        continue
      }
      stageEntry = staged.entry
    }
    const fused = await pairLedger(options.io, options.home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      if (current === undefined) return null
      const moved = tx.transition(row.id, { type: 'staged', ...(stageEntry === undefined ? {} : { stagingRef: stageEntry.ref, stagingExpiresAt: stageEntry.expiresAt }) }, current.version)
      return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
    })
    if (fused === null) {
      pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: failureOf('author', 'row changed before staging record') }))
      totals.failed += 1
      continue
    }
    row = fused
    if (stageEntry !== undefined) await presentStage(options.io, options.home, stageEntry)
    if (isAborted(options.signal)) {
      // Cancel/timeout after staging is not a policy close: remove the in-flight row (so the
      // next scan can re-evaluate it) and drop its stage tree. Never write skipped here.
      await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        return current === undefined ? false : tx.remove(row.id, 'superseded', undefined, current.version).ok
      })
      await dropStage(options.io, options.home, row.id, row.stagingRef)
      stopReason = 'cancelled'
      remaining.push(...candidates.slice(index).map(candidate => ({ pairKey: pairKey(candidate.a, candidate.b), queue: 'verify' as const })))
      break
    }
    await stage('author', { done: index, total: candidates.length })
    let round2: ScanRound2Outcome
    try {
      round2 = await options.ports.round2(row, mergeDecision, options.signal)
    } catch (error) {
      round2 = { kind: 'failed', failure: failureOf('author', error) }
    }
    if (round2.kind === 'merged') {
      finalizeRows.push({ id: row.id, unitId: round2.unitId ?? 'unknown', evidenceSha256: round2.evidenceSha256 ?? 'unknown' })
      pairs.push({ ...pairOf(row, candidate, 'merged', {
        decision: mergeDecision,
        ...(round2.manifestFiles === undefined ? {} : { manifestFiles: round2.manifestFiles }),
        ...(round2.validationIssues === undefined ? {} : { validation: { issues: round2.validationIssues } }),
        ...(round2.unitId === undefined ? {} : { unitId: round2.unitId }),
        ...(round2.target === undefined ? {} : { target: round2.target }),
        ...(round2.usage === undefined ? {} : { usage: round2.usage }),
        ...(round2.lengths === undefined ? {} : { lengths: round2.lengths }),
        archived: round2.archived ?? [],
      }), ...(round2.validationPlan === undefined ? {} : { validationPlan: round2.validationPlan }) })
      totals.merged += 1
      continue
    }
    const failed = round2.failure ?? failureOf('author', 'round2 failed')
    if (failed.code === 'merge-over-limit' || failed.code === 'limit') {
      const reason = 'merge-over-limit'
      const skipped = await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        return current === undefined ? false : tx.transition(row.id, { type: 'skipped', reason, origin: 'system', skipSource: 'system' }, current.version).ok
      })
      if (skipped) await dropStage(options.io, options.home, row.id)
      pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: failed, ...(round2.manifestFiles === undefined ? {} : { manifestFiles: round2.manifestFiles }), ...(round2.criteria === undefined ? {} : { criteria: round2.criteria }), ...(round2.validationIssues === undefined ? {} : { validation: { issues: round2.validationIssues } }) }))
      totals.failed += 1
      continue
    }
    if (failed.code === 'target-changed' || failed.code === 'target-taken' || failed.code === 'source-changed' || failed.code === 'support-changed' || failed.code === 'source-gone') {
      const code = failed.code === 'target-changed' ? 'target-taken' : failed.code === 'support-changed' ? 'source-changed' : failed.code
      const terminalFailure = { ...failed, code, retryable: false, retryFrom: 'none' as const }
      await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) return false
        if (code === 'source-gone') return tx.remove(row.id, 'superseded', undefined, current.version).ok
        return tx.transition(row.id, { type: 'failed', failure: terminalFailure }, current.version).ok
      })
      await dropStage(options.io, options.home, row.id)
      pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: terminalFailure }))
      totals.failed += 1
      continue
    }
    const terminal = failed.code === 'commit-failed' || failed.code === 'validation-failed' || failed.code === 'merge-validation'
    const projected = terminal ? null : await pairLedger(options.io, options.home).transact(tx => {
      const current = tx.rows().find(item => item.id === row.id)
      if (current === undefined) return null
      const moved = tx.transition(row.id, { type: 'failed', failure: failed }, current.version)
      return moved.ok && moved.row !== null ? v4ToLegacy(moved.row) : null
    })
    if (projected === null && terminal) {
      const dropped = await pairLedger(options.io, options.home).transact(tx => {
        const current = tx.rows().find(item => item.id === row.id)
        return current === undefined ? false : tx.remove(row.id, 'superseded', undefined, current.version).ok
      })
      if (dropped) {
        await dropStage(options.io, options.home, row.id, row.stagingRef)
        await recordPair(options.io, options.home, { pairKey: row.pairKey, runId: row.runId ?? 'merge', result: 'failed', ...(row.decision?.target === undefined ? {} : { target: row.decision.target }) })
      }
      pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: failed, ...(round2.manifestFiles === undefined ? {} : { manifestFiles: round2.manifestFiles }), ...(round2.criteria === undefined ? {} : { criteria: round2.criteria }), ...(round2.validationIssues === undefined ? {} : { validation: { issues: round2.validationIssues } }) }))
      totals.failed += 1
      continue
    }
    if (projected === null) { pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: failureOf('author', 'row changed before failure record') })); totals.failed += 1; continue }
    row = projected
    pairs.push(pairOf(row, candidate, 'failed', { decision: mergeDecision, failure: failed, ...(round2.manifestFiles === undefined ? {} : { manifestFiles: round2.manifestFiles }), ...(round2.criteria === undefined ? {} : { criteria: round2.criteria }), ...(round2.validationIssues === undefined ? {} : { validation: { issues: round2.validationIssues } }) }))
    totals.failed += 1
  }

  const selectionReportOnly = (candidates as readonly MergeCandidate[] & { readonly reportOnly?: readonly unknown[] }).reportOnly ?? []
  const selectionReportOnlyPairs: MergeReportPair[] = selectionReportOnly.flatMap(raw => {
    const value = raw as { readonly a?: unknown; readonly b?: unknown; readonly pairKey?: unknown; readonly gate?: MergeReportPair['gate'] }
    if (typeof value.a !== 'string' || typeof value.b !== 'string') return []
    return [{ id: '', pairKey: typeof value.pairKey === 'string' ? value.pairKey : pairKey(value.a, value.b), a: value.a, b: value.b, queue: 'verify' as const, candidate: { a: value.a, b: value.b }, outcome: 'kept' as const, archived: [], ...(value.gate === undefined ? {} : { gate: value.gate }) }]
  })
  return {
    stopReason,
    scope: {
      candidatePairs: (candidates as readonly MergeCandidate[] & { readonly candidatePairs?: number }).candidatePairs ?? candidates.length,
      queueBefore,
    },
    pairs,
    totals,
    notes: [ ...(options.notes ?? []), ...degradedNotes ],
    reportOnly: [...pairs.filter(pair => pair.outcome === 'kept' || pair.gate?.level === 'L0' || pair.gate?.level === 'L1'), ...selectionReportOnlyPairs],
    validationFailures: pairs.filter(pair => pair.failure !== undefined && (pair.failure.stage === 'validate' || pair.failure.code === 'merge-validation' || pair.failure.code === 'merge-over-limit')),
    archived: [...new Set(pairs.flatMap(pair => pair.archived))],
    ...(pairs.find(pair => pair.outcome === 'merged' && pair.unitId !== undefined) === undefined ? {} : { commit: (() => { const pair = pairs.find(item => item.outcome === 'merged' && item.unitId !== undefined)!; return { ...(pair.unitId === undefined ? {} : { unitId: pair.unitId }), ...(pair.target === undefined ? {} : { target: pair.target.actual ?? pair.target.requested }), ...(pair.target === undefined ? {} : { created: pair.target.created }) } })() }),
    ...(pairs.every(pair => pair.usage === undefined) ? {} : { usage: { inputTokens: pairs.reduce((sum, pair) => sum + (pair.usage?.inputTokens ?? 0), 0), outputTokens: pairs.reduce((sum, pair) => sum + (pair.usage?.outputTokens ?? 0), 0), totalTokens: pairs.reduce((sum, pair) => sum + (pair.usage?.totalTokens ?? 0), 0), costCny: pairs.reduce((sum, pair) => sum + (pair.usage?.costCny ?? 0), 0) } }),
    timing: { screeningMs: 0, gateMs: 0, agentMs: Math.max(0, options.now() - startedAt), commitMs: 0 },
    criteria: pairs.map(pair => pair.criteria ?? criteriaFrom(pair.gate?.level ?? 'L2', pair.gate?.verdict ?? 0, pair.decision?.shouldMerge === true ? 'merge' : 'keep')),
    ...(remaining.length === 0 ? {} : { remaining }),
    ...(finalizeRows.length === 0 ? {} : { finalize: async () => {
      for (const item of finalizeRows) {
        const removed = await pairLedger(options.io, options.home).transact(tx => {
          const current = tx.rows().find(entry => entry.id === item.id);
          return current === undefined ? true : tx.remove(item.id, 'committed', { unitId: item.unitId, evidenceSha256: item.evidenceSha256 }, current.version).ok;
        });
        if (!removed) throw new Error('row changed before commit record: ' + item.id);
        await dropStage(options.io, options.home, item.id);
      }
    } })
  }
}
