/** 1b-3 one read aggregate over schema4 and its sidecars. No writes. */
import { createHash } from 'node:crypto'
import type { EvolutionIoLike, RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { readV4Readiness, type V4Readiness } from './schema4.ts'
import { readPairLedgerV4 } from './pair-ledger.ts'
import { readAllStages, type StageEntry } from './stage-aggregate.ts'
import { readRunMeta, type MergeRunMeta } from './run-coordinator.ts'
import { loadPairIndex } from './pair-index-store.ts'
import { mergeReportPath, readMergeReport } from '../report.ts'
import { readCommitReceipts } from '../commit-receipt.ts'
import type { MergeReport } from '../contracts.ts'
import type { V4Row } from './row-v4.ts'
import { pendingExpiry, persistedExpiry, type LiveRowFacts, type PendingExpiryKind } from './live-facts.ts'
import type { QueueId, MergeCounts, DoctorFact } from '../wire.ts'

export interface SnapshotRow { readonly row: V4Row; readonly stage: StageEntry | null; readonly bodies: readonly BodyRef[]; readonly queue: QueueId; readonly expired: boolean; readonly expiredKind?: PendingExpiryKind }
export interface BodyRef { readonly rowId: string; readonly name: string; readonly side: 'live' | 'archive' }
export interface SnapshotRun { readonly record: RunRecord; readonly meta: MergeRunMeta | null; readonly pairs: readonly { readonly pairKey: string; readonly runId: string; readonly result: string; readonly target?: string }[]; readonly report: MergeReport | null; readonly reportRef: string | null }
export interface SnapshotDoctor { readonly counts: MergeCounts; readonly staging: { readonly state: 'ok' | 'absent' | 'unreadable'; readonly dirs: number; readonly oldestAgeMs?: number; readonly detail?: string }; readonly rows: readonly DoctorFact[] }
export interface HistoryItem { readonly name: string; readonly kind: 'merged' | 'deleted' | 'split' | 'other'; readonly reason: string; readonly reasonCode?: string; readonly lastVersion: number; readonly archivedAt: number; readonly sourceRunId?: string; readonly runId?: string; readonly absorbedInto?: string
  readonly generation?: number }
export interface MergeSnapshot {
  readonly wireVersion: 1
  readonly schemaVersion: 4
  readonly readAt: number
  readonly queueRevision: string
  readonly consistency: 'eventual'
  readonly blocked?: { readonly code: string; readonly message: string; readonly readiness: V4Readiness }
  readonly rows: readonly SnapshotRow[]
  readonly stages: readonly StageEntry[]
  readonly runs: readonly SnapshotRun[]
  readonly reports: readonly { readonly runId: string; readonly path: string; readonly report: MergeReport }[]
  readonly report: MergeReport | null
  readonly history: readonly HistoryItem[]
  readonly bodyRefs: readonly BodyRef[]
  readonly doctor: SnapshotDoctor
  readonly approval: { readonly mergeApproval: boolean; readonly platformWrite?: boolean }
  readonly notes: readonly string[]
  readonly degraded: boolean
}
export interface ReadSnapshotOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runs: readonly RunRecord[]
  readonly approval: boolean
  readonly platformWrite?: boolean
  readonly now?: () => number
  readonly history?: () => Promise<readonly HistoryItem[]>
  readonly notes?: readonly string[]
  /** Lazy live-library facts; only invoked when a pending row still needs derivation. */
  readonly live?: () => Promise<LiveRowFacts | undefined>
}
const emptyCounts: MergeCounts = { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }
const queueOf = (state: V4Row['state']): QueueId => state === 'approved' || state === 'fuse' ? 'fuse' : state === 'verify' ? 'verify' : state === 'pending' ? 'pending' : 'skipped'

export async function readMergeSnapshot(options: ReadSnapshotOptions): Promise<MergeSnapshot> {
  const now = options.now ?? (() => Date.now())
  const readAt = now()
  const readiness = await readV4Readiness(options.io, options.home)
  if (!readiness.ok) {
    return { wireVersion: 1, schemaVersion: 4, readAt, queueRevision: 'blocked', consistency: 'eventual', blocked: { code: readiness.code, message: readiness.message, readiness }, rows: [], stages: [], runs: [], reports: [], report: null, history: [], bodyRefs: [], doctor: { counts: emptyCounts, staging: { state: 'absent', dirs: 0 }, rows: [] }, approval: { mergeApproval: options.approval, ...(options.platformWrite === undefined ? {} : { platformWrite: options.platformWrite }) }, notes: options.notes ?? [], degraded: true }
  }
  const ledger = await readPairLedgerV4(options.io, options.home)
  // Read-time derivation only: a stage past its TTL reads as expired even when the
  // index still says present. Reconcile is the writer that persists the correction.
  const stages = (await readAllStages(options.io, options.home)).map(entry =>
    entry.state === 'present' && entry.expiresAt <= readAt ? { ...entry, state: 'expired' as const } : entry)
  const rows: SnapshotRow[] = []
  const bodyRefs: BodyRef[] = []
  // FR-LIFE-14: pending rows whose sources/target moved read as expired even before the
  // reconcile writer stamps them. The live library is read ONLY when such a row exists,
  // and the derivation never writes (GET routes stay zero-write).
  const needsLive = options.live !== undefined && (ledger?.rows ?? []).some(row => (row.state === 'pending' && row.expired === undefined) || row.state === 'verify' || row.state === 'fuse' || row.state === 'approved')
  const live = needsLive ? await options.live!().catch(() => undefined) : undefined
  for (const row of ledger?.rows ?? []) {
    const stage = stages.find(item => item.rowId === row.id) ?? null
    const queue = queueOf(row.state)
    const bodies: BodyRef[] = [{ rowId: row.id, name: row.a, side: 'live' }, { rowId: row.id, name: row.b, side: 'archive' }]
    const expiredKind = persistedExpiry(row) ?? pendingExpiry(row, live)
    rows.push({ row, stage, bodies, queue, expired: expiredKind !== null, ...(expiredKind === null ? {} : { expiredKind }) })
    bodyRefs.push(...bodies)
  }
  const pairIndex = await loadPairIndex(options.io, options.home)
  const runs: SnapshotRun[] = []
  for (const record of options.runs) {
    const meta = await readRunMeta(options.io, options.home, record.id)
    const pairs = [...pairIndex.values()].filter(item => item.runId === record.id).map(item => ({ pairKey: item.pairKey, runId: item.runId, result: item.result, ...(item.target === undefined ? {} : { target: item.target }) }))
    const reportPath = mergeReportPath(options.home, record.id)
    const probe = await readMergeReport(options.io, options.home, record.id)
    const report = probe.kind === 'present' ? probe.value : null
    runs.push({ record, meta, pairs, report, reportRef: report === null ? null : reportPath })
  }
  const reports = runs.filter(run => run.report !== null).map(run => ({ runId: run.record.id, path: run.reportRef as string, report: run.report as MergeReport }))
  const history = options.history === undefined ? await readHistory(options.io, options.home) : await options.history()
  const historyDegraded = options.history === undefined
  const counts = { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }
  for (const item of rows) if (item.expired) counts.expired += 1; else counts.active[item.queue] += 1
  const stagingLost = stages.filter(item => item.state === 'lost' || item.state === 'expired').length
  const doctor: SnapshotDoctor = { counts, staging: { state: stages.length === 0 ? 'absent' : 'ok', dirs: stages.length, ...(stagingLost === 0 ? {} : { detail: String(stagingLost) + ' lost/expired stage(s)' }) }, rows: [
    { key: 'state', status: 'ok', detail: String(rows.length) + ' rows' },
    { key: 'staging-index', status: stages.length === 0 ? 'warn' : 'ok', detail: String(stages.length) + ' entries; ' + String(stagingLost) + ' lost/expired' },
    { key: 'consistency', status: rows.some(item => item.expired) ? 'warn' : 'ok', detail: String(counts.expired) + ' expired' },
  ] }
  const queueRevision = createHash('sha256').update(JSON.stringify({ schemaVersion: 4, rows: rows.map(item => [item.row.id, item.row.version, item.row.state, item.row.updatedAt]), stages: stages.map(item => [item.rowId, item.version, item.state, item.updatedAt, item.ref, item.expiresAt]) })).digest('hex')
  const notes = [...(options.notes ?? [])]
  if (historyDegraded) notes.push('history archive port unavailable; receipts only')
  const ledgerConflicts = [...pairIndex.values()].filter(entry => (entry.result === 'merged' || entry.result === 'undone')
    && rows.some(item => item.row.pairKey === entry.pairKey && (item.row.state === 'verify' || item.row.state === 'pending' || item.row.state === 'approved' || item.row.state === 'fuse')))
  if (ledgerConflicts.length > 0) notes.push('ledger-conflict: pair-index says completed but the ledger still has it active (' + String(ledgerConflicts.length) + ')')
  return { wireVersion: 1, schemaVersion: 4, readAt, queueRevision, consistency: 'eventual', rows, stages, runs, reports, report: reports.at(-1)?.report ?? null, history, bodyRefs, doctor, approval: { mergeApproval: options.approval, ...(options.platformWrite === undefined ? {} : { platformWrite: options.platformWrite }) }, notes, degraded: notes.length > 0 }
}
async function readHistory(io: EvolutionIoLike, home: string): Promise<readonly HistoryItem[]> {
  const receipts = await readCommitReceipts(io, home)
  const out: HistoryItem[] = []
  for (const receipt of receipts) for (const source of receipt.sources) out.push({ name: source, kind: 'merged', reason: 'Merged into ' + receipt.target, reasonCode: 'merged', lastVersion: 1, archivedAt: receipt.at, sourceRunId: receipt.runId })
  return out.map((item, index) => ({ ...item, generation: index + 1 }))
}
