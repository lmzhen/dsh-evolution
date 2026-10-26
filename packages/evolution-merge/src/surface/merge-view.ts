/** Pure wireVersion=1 builders over one MergeSnapshot. No IO, no writes. */
import type { MergeSnapshot, SnapshotRow, SnapshotRun, BodyRef } from '../domain/merge-snapshot.ts'
import type { Facts, QueuePage, RowFact, BodyView, HistoryView, RunView, RunDetail, RunsView, DoctorView, QueueId, MergeCounts, ActionRef, VerifySubState } from '../wire.ts'
import { MERGE_COMMAND_SURFACE } from '../command-surface.ts'

const base = '/evolution merge '
function counts(rows: readonly SnapshotRow[]): MergeCounts {
  const active = { verify: 0, pending: 0, fuse: 0, skipped: 0 }
  let expired = 0
  for (const item of rows) {
    const skippedExpired = item.row.state === 'skipped' && item.row.expiredAt !== undefined
    if (item.expired || skippedExpired) expired += 1
    else active[item.queue] += 1
  }
  return { active, expired }
}
const rowActionTemplates = new Map(MERGE_COMMAND_SURFACE.commands.flatMap(command => command.rowActions.map(action => [action.id, action] as const)))
function renderAction(id: ActionRef['id'], context: { id: string; a: string; b: string; runId?: string | undefined }, enabled = true, confirmOverride?: boolean, reason?: string): ActionRef {
  const template = rowActionTemplates.get(id)
  if (template === undefined) throw new Error('missing CommandDef rowAction: ' + id)
  const command = template.command.replaceAll('{id}', context.id).replaceAll('{a}', context.a).replaceAll('{b}', context.b).replaceAll('{runId}', context.runId ?? context.id)
  return { id, command, confirm: confirmOverride ?? template.confirm === true, enabled, ...(enabled ? {} : { disabledReason: reason ?? 'invalid' }) }
}
function actions(row: SnapshotRow): readonly ActionRef[] {
  const context = { id: row.row.id, a: row.row.a, b: row.row.b, ...(row.row.runId === undefined ? {} : { runId: row.row.runId }) }
  if (row.row.state === 'pending' && row.row.expired !== undefined) return [renderAction('discard', context, true, true), renderAction('pair', context, true, true)]
  if (row.row.state === 'pending') return [renderAction('approve', context), renderAction('reject', context, true, true), renderAction('discard', context, true, true)]
  if (row.row.state === 'approved' || row.row.state === 'fuse') {
    if (row.row.failure !== undefined && row.row.failure.retryable === false) return [renderAction('pair', context, true, true), renderAction('discard', context, true, true)]
    return [renderAction('retry-resume', context, true, true), renderAction('discard', context, true, true), renderAction('status', context)]
  }
  if (row.row.state === 'skipped') return [renderAction('restore', context, true, true)]
  if (row.row.state === 'verify') return [renderAction('retry-candidates', context)]
  return [renderAction('pair', context)]
}
function verifyState(row: SnapshotRow): VerifySubState | undefined {
  if (row.row.state !== 'verify') return undefined
  if (row.row.failure?.code === 'cancelled') return 'cancelled'
  if (row.row.failure !== undefined) return 'failed'
  if (row.row.verifySubState === 'screened') return 'running'
  return 'queued'
}
export function toRowFact(row: SnapshotRow): RowFact {
  const state = row.row
  const target = state.state === 'pending' || state.state === 'approved' || state.state === 'fuse' ? { requested: state.target, ...(state.state === 'approved' || state.state === 'fuse' ? { actual: state.target } : {}) } : undefined
  const summary = state.state === 'pending' ? { a: state.decision.aSummary ?? null, b: state.decision.bSummary ?? null, rationale: state.decision.rationale } : undefined
  const stage = row.stage
  const staging = stage === null ? undefined : stage.state === 'reserved' || stage.state === 'present' ? { state: 'kept' as const, ...(stage.expiresAt === undefined ? {} : { expiresAt: stage.expiresAt }) } : undefined
  const stageField = stage === null ? undefined : stage.state === 'present' || stage.state === 'reserved' ? 'present' as const : stage.state === 'lost' ? 'lost' as const : 'expired' as const
  const expiredKind = row.expiredKind ?? (state.state === 'pending' ? state.expired : undefined)
  const expired = expiredKind !== undefined ? { kind: expiredKind, at: Date.parse(state.updatedAt) } : state.state === 'skipped' && state.expiredAt !== undefined ? { kind: 'skipped-ttl' as const, at: state.expiredAt } : undefined
  return {
    id: state.id, state: state.state, queue: row.queue,
    ...(verifyState(row) === undefined ? {} : { verifySubState: verifyState(row)! }),
    ...(stageField === undefined ? {} : { stage: stageField }),
    a: state.a, b: state.b,
    ...(target === undefined ? {} : { target }),
    ...(summary === undefined ? {} : { summary }),
    ...(state.state === 'skipped' ? { reason: state.reason, reasonCode: state.reason } : {}),
    ...(state.origin === undefined ? {} : { origin: state.origin }),
    ...(state.failure === undefined ? {} : { failure: { stage: state.failure.stage, code: state.failure.code, retryable: state.failure.retryable, retryFrom: state.failure.retryFrom, detail: state.failure.message } }),
    ...(staging === undefined ? {} : { staging }),
    ...(expired === undefined ? {} : { expired }),
    ...(state.attempts === undefined ? {} : { attempts: state.attempts }),
    ...(state.state === 'skipped' && state.expiredAt !== undefined ? { expiresAt: state.expiredAt } : {}),
    bodies: row.bodies,
    createdAt: Date.parse(state.createdAt),
    updatedAt: Date.parse(state.updatedAt),
    actions: actions(row),
  }
}
function runView(run: SnapshotRun, readAt: number, includeResultRef = false): RunView {
  void includeResultRef
  const record = run.record
  const metaPhase = run.meta?.phase
  const state = metaPhase === 'undone' ? 'undone' as const
    : run.meta?.stopReason === 'interrupted' ? 'interrupted' as const
      : run.meta?.approval === 'pending' ? 'awaiting-approval' as const
        : record.state
  const stopReason = run.meta?.stopReason ?? (record.state === 'cancelled' ? 'cancelled' : record.state === 'failed' ? 'failed' : record.state === 'succeeded' ? 'completed' : undefined)
  return { wireVersion: 1, readAt, id: record.id, state, command: record.command ?? 'scan', ...(record.stage === undefined ? {} : { stage: record.stage }), progress: record.progress === undefined ? null : { done: record.progress.done, total: record.progress.total }, startedAt: record.startedAt, ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }), ...(stopReason === undefined ? {} : { stopReason }), ...(record.failure === undefined ? {} : { failure: { stage: 'settle', code: 'run-failed', retryable: false, retryFrom: 'none', detail: record.failure } }), ...(record.parentRunId === undefined ? {} : { parentRunId: record.parentRunId }), ...(run.pairs[0]?.pairKey === undefined ? {} : { currentPairKey: run.pairs[0].pairKey }), ...(record.resultRef === undefined ? {} : { resultRef: record.resultRef }), actions: [{ id: 'status', command: base + 'status ' + record.id, confirm: false, enabled: true }, { id: 'report', command: base + 'report ' + record.id, confirm: false, enabled: record.resultRef !== undefined }, { id: 'cancel', command: base + 'cancel ' + record.id, confirm: false, enabled: record.state === 'running' }] }
}
export function buildFacts(snapshot: MergeSnapshot): Facts {
  const ordered = [...snapshot.runs].sort((a, b) => b.record.startedAt - a.record.startedAt)
  const active = ordered.find(run => run.record.state === 'running')
  const last = ordered.find(run => run.record.state !== 'running')
  return { wireVersion: 1, readAt: snapshot.readAt, approval: { mergeApproval: snapshot.approval.mergeApproval, ...(snapshot.approval.platformWrite === undefined ? {} : { platformWrite: snapshot.approval.platformWrite }) }, counts: counts(snapshot.rows), active: active === undefined ? null : runView(active, snapshot.readAt), last: last === undefined ? null : runView(last, snapshot.readAt), startCommands: { scan: base + 'scan', pair: base + 'pair <a> <b>' }, fallback: MERGE_COMMAND_SURFACE.fallback, notes: snapshot.notes, degraded: snapshot.degraded }
}
function encodeCursor(snapshot: MergeSnapshot, offset: number): string { return Buffer.from(JSON.stringify({ revision: snapshot.queueRevision, offset }), 'utf8').toString('base64url') }
export function parseCursor(cursor: string, snapshot: MergeSnapshot): number {
  try { const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { revision?: unknown; offset?: unknown }; if (value.revision !== snapshot.queueRevision || typeof value.offset !== 'number' || value.offset < 0) throw new Error('stale') ; return value.offset } catch { throw new Error('queue cursor is stale; reload') }
}
export function buildQueuePage(snapshot: MergeSnapshot, queue: QueueId, expiredOnly: boolean, cursor?: string, limit = 50): QueuePage {
  const selected = snapshot.rows.filter(row => row.queue === queue && (queue === 'skipped' ? true : expiredOnly ? row.expired : !row.expired))
  const offset = cursor === undefined ? 0 : parseCursor(cursor, snapshot)
  const page = selected.slice(offset, offset + Math.max(0, Math.min(200, limit)))
  const next = offset + page.length < selected.length ? encodeCursor(snapshot, offset + page.length) : undefined
  return { wireVersion: 1, readAt: snapshot.readAt, queue, expiredOnly, counts: counts(snapshot.rows), rows: page.map(toRowFact), ...(next === undefined ? {} : { nextCursor: next }), notes: snapshot.notes }
}
export function buildBodyView(snapshot: MergeSnapshot, ref: BodyRef, text: string): BodyView {
  const max = 64 * 1024
  const truncated = Buffer.byteLength(text, 'utf8') > max
  const body = truncated ? text.slice(0, max) : text
  return { wireVersion: 1, readAt: snapshot.readAt, name: ref.name, side: ref.side, text: body, markdown: true, truncated, totalBytes: Buffer.byteLength(text, 'utf8') }
}
export function buildHistoryView(snapshot: MergeSnapshot): HistoryView { return { wireVersion: 1, readAt: snapshot.readAt, items: snapshot.history } }
export function buildRunView(snapshot: MergeSnapshot, runId: string): RunView | null { const run = snapshot.runs.find(item => item.record.id === runId); return run === undefined ? null : runView(run, snapshot.readAt) }
export function buildRunDetail(snapshot: MergeSnapshot, runId: string): RunDetail | null {
  const run = snapshot.runs.find(item => item.record.id === runId); if (run === undefined) return null
  return { ...runView(run, snapshot.readAt, true), ...(run.meta === null ? {} : { meta: { phase: run.meta.phase, ...(run.meta.approval === undefined ? {} : { approval: run.meta.approval }) } }), ...(run.reportRef === null ? {} : { reportRef: run.reportRef }), pairs: run.pairs.map(pair => ({ pairKey: pair.pairKey, a: pair.pairKey.split('\u0000')[0] ?? '', b: pair.pairKey.split('\u0000')[1] ?? '', outcome: pair.result === 'kept' ? 'kept' : pair.result === 'failed' ? 'failed' : pair.result === 'cancelled' ? 'cancelled' : 'merged', ...(pair.target === undefined ? {} : { target: { requested: pair.target } }) })), pairsTruncated: false }
}
export function buildRunsView(snapshot: MergeSnapshot): RunsView { return { wireVersion: 1, readAt: snapshot.readAt, runs: [...snapshot.runs].sort((a, b) => b.record.startedAt - a.record.startedAt).map(run => runView(run, snapshot.readAt, true)) } }
export function buildDoctorView(snapshot: MergeSnapshot): DoctorView {
  return { wireVersion: 1, readAt: snapshot.readAt, counts: snapshot.doctor.counts, ...(snapshot.runs[0] === undefined ? {} : { latestRun: runView(snapshot.runs[0], snapshot.readAt) }), staging: snapshot.doctor.staging, approval: snapshot.approval, ...(snapshot.hostOnly === undefined ? {} : { hostOnly: snapshot.hostOnly }), ...(snapshot.blocked === undefined ? {} : { blocked: { code: snapshot.blocked.code, message: snapshot.blocked.message } }), rows: snapshot.doctor.rows }
}
