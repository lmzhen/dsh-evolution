/**
 * Merge doctor rows: state, pending, gate cache and staging are each probed read-only.
 * A missing file is an empty feature, not a failure; an unreadable file is a warning the
 * operator can act on. This module never repairs or writes.
 */
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { probeList, readTreeLock, runsFile, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { migrationJournalPath, migrationReportPath, v2BackupPath } from './domain/state-bootstrap.ts'
import { readMergeSnapshot } from './domain/merge-snapshot.ts'
import { validateArtifacts, type RowState, type RunState, type JournalState, type EvidenceState, type StagingState } from './domain/consistency.ts'
import { readJournal } from './domain/commit-journal-store.ts'
import { stagingRoot } from './staging.ts'
import { readReconcileReport, type ReconcileReport } from './domain/reconcile.ts'
import type { DoctorView } from './wire.ts'

export const MERGE_DOCTOR_SCHEMA_VERSION = 3

/** The global doctor's merge line; built from the DoctorView envelope, never from raw files. */
export interface MergeDoctorFact {
  readonly status: 'ok' | 'warn' | 'fail' | 'unknown'
  readonly detail: string
  readonly remedy?: string
}

/** Compose the one-line global-doctor fact from buildDoctorView + the last reconcile report. */
export function mergeDoctorFact(view: DoctorView, report: ReconcileReport | null): MergeDoctorFact {
  const counts = view.counts
  const reconcileText = report === null
    ? 'reconcile 尚未运行'
    : report.state === 'blocked'
      ? 'reconcile blocked ' + (report.code ?? 'merge-state-blocked')
      : 'reconcile ' + String(report.actions.length) + ' 项动作'
  const problems: string[] = []
  if (view.blocked !== undefined) problems.push('state blocked ' + view.blocked.code)
  if (view.hostOnly !== undefined) problems.push('宿主数据面不可用 ' + view.hostOnly.code)
  if (view.staging.state === 'unreadable') problems.push('staging 索引不可读' + (view.staging.detail === undefined ? '' : '：' + view.staging.detail))
  if (counts.expired > 0) problems.push('expired ' + String(counts.expired))
  const unstable = view.rows.filter(row => row.status === 'warn' || row.status === 'fail')
  if (unstable.length > 0) problems.push(unstable.map(row => row.key + '=' + row.status).join(','))
  if (report?.state === 'blocked') problems.push('reconcile blocked')
  const latest = view.latestRun
  const latestText = latest === undefined ? '' : '；最近 run ' + latest.id + ' [' + latest.state + ']'
  const detail = 'verify ' + String(counts.active.verify) + ' / pending ' + String(counts.active.pending) + ' / fuse ' + String(counts.active.fuse) + ' / skipped ' + String(counts.active.skipped) + ' / expired ' + String(counts.expired)
    + '；staging ' + view.staging.state + ' dirs=' + String(view.staging.dirs)
    + '；审批 ' + (view.approval.mergeApproval ? '开' : '关') + '；' + reconcileText + latestText
    + (problems.length === 0 ? '' : '；问题：' + problems.join('；'))
  const status: MergeDoctorFact['status'] = problems.length === 0
    ? 'ok'
    : view.blocked !== undefined || view.hostOnly !== undefined || report?.state === 'blocked' ? 'fail' : 'warn'
  return problems.length === 0 ? { status, detail } : { status, detail, remedy: '运行 /evolution merge doctor 查看逐项；必要时 /evolution merge reconcile 收敛' }
}

export interface MergeDoctorRow {
  readonly key: string
  readonly label: string
  readonly status: 'ok' | 'warn' | 'blocked' | 'unknown'
  readonly detail: string
}

/** Global doctor host section: a missing merge mount must fail with E-325, not render empty. */
export function mergeDoctorAvailability(mounted: boolean): { readonly ok: true } | { readonly ok: false; readonly code: 'E-325' } {
  return mounted ? { ok: true } : { ok: false, code: 'E-325' }
}

export async function mergeDoctor(io: EvolutionIoLike, home: string, configuredRoot?: string): Promise<readonly MergeDoctorRow[]> {
  const rows: MergeDoctorRow[] = []
  const snapshot = await readMergeSnapshot({ io, home, runs: [], approval: false })
  const hasState = await io.exists(join(home, 'merge', 'merge-state.json'))
  const counts = snapshot.doctor.counts.active
  rows.push({
    key: 'state',
    label: '合并状态',
    status: snapshot.blocked === undefined || !hasState ? 'ok' : 'warn',
    detail: snapshot.blocked === undefined ? 'pairs ' + String(snapshot.rows.length) + '；verify ' + String(counts.verify) + ' / pending ' + String(counts.pending) + ' / fuse ' + String(counts.fuse) + ' / skipped ' + String(counts.skipped) : snapshot.blocked.code + ': ' + snapshot.blocked.message,
  })
  const recoveryRuns = new Set<string>()
  try {
    const raw = await io.readText(join(home, 'merge', 'recovery.json'))
    if (raw !== null) for (const report of JSON.parse(raw) as readonly { readonly runId?: string; readonly ok?: boolean }[]) if (report.ok === true && report.runId !== undefined) recoveryRuns.add(report.runId)
  } catch {}
  const receiptRuns = new Set<string>()
  const receiptDir = await probeList(io, join(home, 'merge', 'receipts'))
  if (receiptDir.kind === 'present') for (const name of receiptDir.value) receiptRuns.add(name)
  const invalid: { id: string; reason: string }[] = []
  if (snapshot.blocked !== undefined) invalid.push({ id: 'state', reason: snapshot.blocked.code })
  for (const item of snapshot.rows) {
    const row = item.row
    const runId = row.runId ?? (item.stage?.ref.split('/')[0])
    const artifactRow: RowState = row.state === 'approved' ? 'approved' : row.state === 'fuse' ? 'fuse' : row.state
    const run: RunState = runId === undefined ? 'none' : row.state === 'pending' ? 'awaiting-approval' : 'running'
    const staging: StagingState = item.stage === null ? (row.state === 'fuse' ? 'missing' : 'none') : item.stage.state === 'present' || item.stage.state === 'reserved' ? 'kept' : row.state === 'fuse' ? 'missing' : 'none'
    const phase = runId === undefined ? null : await readJournal(io, home, runId)
    const journal: JournalState = phase === null ? 'none' : phase.phase === 'prepared' ? 'prepared' : phase.phase === 'target-written' || phase.phase === 'sources-archived' ? 'committing' : phase.phase === 'committed' ? 'committed' : phase.phase === 'rolled-back' ? 'rolled-back' : 'failed'
    const evidence: EvidenceState = runId !== undefined && await io.readText(join(home, 'merge', 'receipts', runId + '.json')).catch(() => null) !== null ? 'receipt' : 'none'
    const result = validateArtifacts({ row: artifactRow, run, staging, journal, evidence, activeRuns: run === 'running' || run === 'awaiting-approval' ? 1 : 0, ...(runId !== undefined && recoveryRuns.has(runId) ? { recovery: true } : {}) })
    if (!result.ok) invalid.push({ id: row.id, reason: result.reason ?? 'not-allowed' })
  }
  rows.push({ key: 'merge-state-v3', label: 'state schema', status: snapshot.blocked === undefined ? 'ok' : 'warn', detail: snapshot.blocked === undefined ? 'schemaVersion 4' : snapshot.blocked.code })
  let quarantineCount = 0
  try { const qraw = await io.readText(join(home, 'merge', 'merge-state.quarantine.json')); if (qraw !== null) { const parsed = JSON.parse(qraw) as unknown; quarantineCount = Array.isArray(parsed) ? parsed.length : 0 } } catch { quarantineCount = -1 }
  rows.push({ key: 'quarantine', label: 'quarantine', status: quarantineCount < 0 ? 'unknown' : quarantineCount === 0 ? 'ok' : 'warn', detail: quarantineCount < 0 ? 'quarantine 不可读' : quarantineCount + ' 行待人工检查' })
  const holder = await readTreeLock(io, home).catch(() => null)
  rows.push({ key: 'tree-lock', label: 'tree lock', status: holder == null ? 'ok' : 'warn', detail: holder == null ? 'free' : 'holder pid=' + String(holder.pid) + ' epoch=' + String(holder.epoch) + ' token=' + holder.token.slice(0, 8) })
  const backupPath = v2BackupPath(home)
  const backupRaw = await io.readText(backupPath).catch(() => null)
  const backupMode = await stat(backupPath).then(value => value.mode).catch(() => null)
  const backupReadOnly = backupMode === null ? null : (backupMode & 0o200) === 0
  rows.push({ key: 'backup', label: 'v2 backup', status: backupRaw === null ? 'unknown' : backupReadOnly === false ? 'warn' : 'ok', detail: backupRaw === null ? 'no v2 backup (not migrated or already cleaned)' : 'merge-state.v2.bak.json sha256=' + createHash('sha256').update(backupRaw).digest('hex').slice(0, 16) + ' readonly=' + String(backupReadOnly) })
  const journal = await io.readText(migrationJournalPath(home)).catch(() => null)
  const report = await io.readText(migrationReportPath(home)).catch(() => null)
  rows.push({ key: 'migration', label: 'state migration', status: snapshot.blocked === undefined ? (journal === null ? 'ok' : 'warn') : 'warn', detail: snapshot.blocked === undefined ? (journal === null ? (report === null ? 'ready (no migration report)' : 'ready; report present') : 'ready; migration journal pending') : snapshot.blocked.code + ': ' + snapshot.blocked.message })
  rows.push({ key: 'staging-index', label: 'staging index', status: 'ok', detail: String(snapshot.stages.length) + ' index entries' })
  const claims = await probeList(io, join(home, 'merge', 'claims'))
  rows.push({ key: 'target-claim', label: 'target claim', status: claims.kind === 'unknown' ? 'unknown' : 'ok', detail: claims.kind === 'unknown' ? 'claims unreadable' : claims.kind === 'absent' ? 'no claims' : String(claims.value.length) + ' claim files' })
  let orphanRuns = 0
  let runCount = 0
  try {
    const raw = await io.readText(runsFile(home))
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { runs?: readonly { state?: string; pid?: number }[] }
      runCount = parsed.runs?.length ?? 0
      for (const run of parsed.runs ?? []) {
        if (run.state !== 'running' || typeof run.pid !== 'number') continue
        try { process.kill(run.pid, 0) } catch { orphanRuns += 1 }
      }
    }
  } catch { orphanRuns = -1 }
  rows.push({ key: 'runs', label: 'run owner', status: orphanRuns < 0 ? 'unknown' : orphanRuns === 0 ? 'ok' : 'warn', detail: orphanRuns < 0 ? 'runs.json unreadable' : String(runCount) + ' runs; ' + String(orphanRuns) + ' dead-owner running' })
  rows.push({ key: 'install', label: 'install form', status: io.exists === undefined ? 'unknown' : 'ok', detail: 'merge plugin loaded' })
  const reconcile = await readReconcileReport(io, home)
  rows.push({
    key: 'reconcile',
    label: '状态收敛',
    status: reconcile === null ? 'unknown' : reconcile.state === 'blocked' ? 'warn' : reconcile.actions.length > 0 ? 'warn' : 'ok',
    detail: reconcile === null
      ? '尚无 reconcile 报告（启动或 /evolution merge reconcile 会生成）'
      : reconcile.state === 'blocked'
        ? 'blocked：' + (reconcile.code ?? 'merge-state-blocked') + (reconcile.message === undefined ? '' : ' — ' + reconcile.message)
        : String(reconcile.actions.length) + ' 项动作（' + new Date(reconcile.at).toISOString() + '）' + (reconcile.actions.length === 0 ? '' : '：' + reconcile.actions.map(action => action.rowId + '=' + action.code).join(', ')),
  })
  rows.push({ key: 'consistency', label: '一致性', status: snapshot.blocked !== undefined ? 'blocked' : invalid.length === 0 ? 'ok' : 'warn', detail: snapshot.blocked !== undefined ? 'blocked: ' + snapshot.blocked.code : invalid.length === 0 ? '无非法组合' : String(invalid.length) + ' 行需人工检查: ' + invalid.map(row => row.id + '=' + row.reason).join(', ') })
  const modelRoot = configuredRoot?.trim() ?? ''
  if (modelRoot === '') {
    rows.push({ key: 'models', label: '合并模型', status: 'warn', detail: '未配置 mergeModelsRoot；合并扫描会 fail loud' })
  } else {
    const int8 = join(modelRoot, 'potion-multilingual-128M-int8')
    const pca = join(modelRoot, 'potion-multilingual-128M-pca64-int8')
    const ok = await io.exists(int8) && await io.exists(pca)
    rows.push({ key: 'models', label: '合并模型', status: ok ? 'ok' : 'warn', detail: ok ? modelRoot : '缺少 int8/pca64：' + modelRoot })
  }
  const runsDir = join(home, 'merge', 'runs')
  const listed = await probeList(io, runsDir)
  rows.push({
    key: 'staging',
    label: '暂存树',
    status: listed.kind === 'unknown' ? 'unknown' : 'ok',
    detail: listed.kind === 'unknown'
      ? '无法列出 ' + runsDir + '：' + listed.reason
      : listed.kind === 'absent' ? '0 个 run 目录' : String(listed.value.length) + ' 个 run 目录',
  })
  rows.push({
    key: 'staging-path',
    label: '暂存路径',
    status: 'ok',
    detail: stagingRoot(home, '<runId>'),
  })
  try {
    const raw = await io.readText(join(home, 'merge', 'recovery.json'))
    if (raw !== null) {
      const reports = JSON.parse(raw) as readonly { readonly action?: string; readonly ok?: boolean; readonly runId?: string }[]
      const failed = reports.filter(report => report.ok !== true)
      rows.push({
        key: 'recovery',
        label: '提交恢复',
        status: failed.length === 0 ? 'ok' : 'warn',
        detail: failed.length === 0
          ? String(reports.length) + ' 条恢复报告，无待处理'
          : String(failed.length) + ' 条待处理：' + failed.map(report => (report.runId ?? '?') + '=' + (report.action ?? '?')).join(', '),
      })
    }
  } catch {
    rows.push({ key: 'recovery', label: '提交恢复', status: 'unknown', detail: '无法读取 merge/recovery.json' })
  }
  return rows
}
