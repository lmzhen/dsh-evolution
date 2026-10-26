/** G5-4 wire projections from merge rows to the frozen envelopes. */
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRow } from './contracts.ts'
import { countsOf, toRunView } from './facts.ts'
import type { BodyView, DoctorView, HistoryView, MergeCounts, QueueId, QueuePage, RowFact, RunView, RunsView } from './wire.ts'

const queueOf = (row: MergeRow): QueueId => row.state === 'approved' ? 'fuse' : row.queue
const expiredOf = (row: MergeRow): boolean => row.expired !== undefined

/** Host-owned row actions; client only renders/copies them. */
export function actionRefs(row: MergeRow): RowFact['actions'] {
  const base = '/evolution merge '
  const disabled = row.expired === undefined ? undefined : 'expired'
  const action = (id: RowFact['actions'][number]['id'], confirm = false, enabled = true): RowFact['actions'][number] => ({ id, command: base + id + ' ' + row.id, confirm, enabled, ...(enabled ? {} : { disabledReason: disabled ?? 'invalid' }) })
  if (row.state === 'pending' && row.expired !== undefined) return [{ id: 'discard', command: base + 'discard ' + row.id, confirm: true, enabled: true }, { id: 'pair', command: base + 'pair ' + row.a + ' ' + row.b, confirm: true, enabled: true }]
  if (row.state === 'pending') return [action('approve'), action('reject', true), action('discard', true)]
  if (row.state === 'approved' || row.state === 'fuse') {
    if (row.failure !== undefined && row.failure.retryable === false) return [{ id: 'pair', command: base + 'pair ' + row.a + ' ' + row.b, confirm: true, enabled: true }, action('discard', true)]
    return [{ id: 'retry-resume', command: base + 'resume --retry ' + row.id, confirm: true, enabled: true }, action('discard', true), action('status')]
  }
  if (row.state === 'skipped') return [action('restore', true)]
  if (row.state === 'verify') return [{ id: 'retry-candidates', command: base + 'candidates --retry ' + row.id, confirm: false, enabled: true }]
  return [action('pair')]
}

export function toRowFact(row: MergeRow, actions: RowFact['actions'] = actionRefs(row)): RowFact {
  return {
    id: row.id,
    state: row.state,
    queue: queueOf(row),
    ...(row.state === 'verify' ? { verifySubState: 'queued' as const } : {}),
    a: row.a,
    b: row.b,
    ...(row.target === undefined ? {} : { target: { requested: row.target.requested, ...(row.target.actual === undefined ? {} : { actual: row.target.actual }), ...(row.target.created === undefined ? {} : { created: row.target.created }) } }),
    ...(row.state === 'pending' ? { summary: { a: null, b: null, rationale: row.decision?.rationale ?? null } } : {}),
    ...(row.reason === undefined ? {} : { reason: row.reason }),
    ...(row.state === 'skipped' ? { origin: row.origin ?? 'system' } : {}),
    ...(row.failure === undefined ? {} : { failure: { stage: row.failure.stage === 'screening' ? 'screening' : row.failure.stage === 'decide' ? 'decide' : row.failure.stage === 'author' ? 'author' : row.failure.stage === 'validate' ? 'validate' : 'commit', code: row.failure.code, retryable: row.failure.retryable, retryFrom: row.failure.retryFrom } }),
    ...(row.stagingRef === undefined ? {} : { staging: { state: 'kept' as const, ...(row.stagingExpiresAt === undefined ? {} : { expiresAt: row.stagingExpiresAt }) } }),
    ...(row.expired === undefined ? {} : { expired: { kind: row.expired, at: Date.parse(row.updatedAt) } }),
    ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
    ...(row.decision?.confidence === undefined ? {} : { confidence: row.decision.confidence }),
    ...(row.state === 'skipped' && row.stagingExpiresAt !== undefined ? { expiresAt: row.stagingExpiresAt } : {}),
    createdAt: Date.parse(row.createdAt),
    updatedAt: Date.parse(row.updatedAt),
    actions,
  }
}

export function toQueuePage(rows: readonly MergeRow[], queue: QueueId, expiredOnly: boolean, readAt: number, limit = 50): QueuePage {
  const filtered = rows.filter(row => queueOf(row) === queue && (expiredOnly ? expiredOf(row) : !expiredOf(row)))
  const page = filtered.slice(0, Math.max(0, Math.min(200, limit)))
  const counts: MergeCounts = countsOf(rows)
  return { wireVersion: 1, readAt, queue, expiredOnly, counts, rows: page.map(row => toRowFact(row)), ...(filtered.length > page.length ? { nextCursor: String(page.length) } : {}), notes: [] }
}

export function toRunsView(runs: readonly RunRecord[], readAt: number): RunsView {
  const ordered = [...runs].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)
  return { wireVersion: 1, readAt, runs: ordered.map(run => toRunView(run, readAt)) }
}

export interface DoctorSourceFact {
  readonly key: string
  readonly status: 'ok' | 'warn' | 'fail' | 'unknown'
  readonly count?: number
  readonly detail?: string
}

export function toDoctorView(input: {
  readonly readAt: number
  readonly counts: MergeCounts
  readonly latestRun?: RunView
  readonly approval: { mergeApproval: boolean; writeApproval?: boolean }
  readonly staging: DoctorView['staging']
  readonly rows: readonly DoctorSourceFact[]
}): DoctorView {
  return {
    wireVersion: 1,
    readAt: input.readAt,
    counts: input.counts,
    ...(input.latestRun === undefined ? {} : { latestRun: input.latestRun }),
    staging: input.staging,
    approval: input.approval,
    rows: input.rows.map(row => ({ key: row.key, status: row.status, ...(row.count === undefined ? {} : { count: row.count }), ...(row.detail === undefined ? {} : { detail: row.detail }) })),
  }
}

export function toBodyView(name: string, side: 'live' | 'archive', text: string, readAt: number): BodyView {
  return { wireVersion: 1, readAt, name, side, text, markdown: true, truncated: false, totalBytes: Buffer.byteLength(text, 'utf8') }
}

export function toHistoryView(items: readonly { name: string; kind: 'merged' | 'deleted' | 'split' | 'other'; reason: string; lastVersion: number; archivedAt: string; sourceRunId?: string }[], readAt: number): HistoryView {
  return { wireVersion: 1, readAt, items: items.map(item => ({ name: item.name, kind: item.kind, reason: item.reason, lastVersion: item.lastVersion, archivedAt: Date.parse(item.archivedAt), ...(item.sourceRunId === undefined ? {} : { sourceRunId: item.sourceRunId }) })) }
}
