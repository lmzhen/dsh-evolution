/**
 * Merge doctor rows: state, pending, gate cache and staging are each probed read-only.
 * A missing file is an empty feature, not a failure; an unreadable file is a warning the
 * operator can act on. This module never repairs or writes.
 */
import { join } from 'node:path'
import { probeList, readTreeLock, runsFile, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { v2BackupPath } from './domain/state-v3.ts'
import { loadMergeState } from './state.ts'
import { countRows } from './status.ts'
import { stagingRoot } from './staging.ts'
import { validateArtifacts } from './domain/consistency.ts'
import { readJournal } from './domain/commit-journal-store.ts'
import { loadStateSchema } from './state.ts'

export const MERGE_DOCTOR_SCHEMA_VERSION = 3

export interface MergeDoctorRow {
  readonly key: string
  readonly label: string
  readonly status: 'ok' | 'warn' | 'unknown'
  readonly detail: string
}

/** Global doctor host section: a missing merge mount must fail with E-325, not render empty. */
export function mergeDoctorAvailability(mounted: boolean): { readonly ok: true } | { readonly ok: false; readonly code: 'E-325' } {
  return mounted ? { ok: true } : { ok: false, code: 'E-325' }
}

export async function mergeDoctor(io: EvolutionIoLike, home: string, configuredRoot?: string): Promise<readonly MergeDoctorRow[]> {
  const rows: MergeDoctorRow[] = []
  const loaded = await loadMergeState(io, home)
  const counts = countRows(loaded.state.rows)
  rows.push({
    key: 'state',
    label: '合并状态',
    status: loaded.note === undefined ? 'ok' : 'warn',
    detail: loaded.note ?? 'pairs ' + String(loaded.state.rows.length) + '；verify ' + String(counts.verify) + ' / pending ' + String(counts.pending) + ' / fuse ' + String(counts.fuse) + ' / skipped ' + String(counts.skipped),
  })
  const recoveryRuns = new Set<string>()
  try {
    const raw = await io.readText(join(home, 'merge', 'recovery.json'))
    if (raw !== null) for (const report of JSON.parse(raw) as readonly { readonly runId?: string; readonly ok?: boolean }[]) if (report.ok === true && report.runId !== undefined) recoveryRuns.add(report.runId)
  } catch {}
  const receiptRuns = new Set<string>()
  const receiptDir = await probeList(io, join(home, 'merge', 'receipts'))
  if (receiptDir.kind === 'present') for (const name of receiptDir.value) receiptRuns.add(name)
  const invalid = [] as typeof loaded.state.rows[number][]
  for (const row of loaded.state.rows) {
    const run = row.state === 'pending' && row.runId !== undefined ? 'awaiting-approval' as const : row.runId === undefined ? 'none' as const : 'running' as const
    const staging = row.stagingRef !== undefined ? 'kept' as const : row.state === 'fuse' ? 'missing' as const : 'none' as const
    const phase = row.runId === undefined ? undefined : (await readJournal(io, home, row.runId))?.phase
    const journal = phase === undefined || phase === null ? 'none' as const
      : phase === 'committed' ? 'committed' as const
      : phase === 'prepared' ? 'prepared' as const
      : phase === 'rolled-back' ? 'rolled-back' as const
      : phase === 'failed' ? 'failed' as const
      : 'committing' as const
    const evidence = row.runId !== undefined && receiptRuns.has(row.runId) ? 'receipt' as const : 'none' as const
    const recovery = row.runId !== undefined && recoveryRuns.has(row.runId)
    if (!validateArtifacts({ row: row.state, run, staging, journal, evidence, activeRuns: run === 'running' || run === 'awaiting-approval' ? 1 : 0, recovery }).ok) invalid.push(row)
  }
  const schema = await loadStateSchema(io, home)
  rows.push({ key: 'merge-state-v3', label: 'state schema', status: schema === 3 ? 'ok' : schema === 2 ? 'warn' : 'unknown', detail: schema === 3 ? 'schemaVersion 3' : schema === 2 ? 'schemaVersion 2；等待 v3 迁移' : 'schemaVersion 未知/不可读' })
  let quarantineCount = 0
  try { const qraw = await io.readText(join(home, 'merge', 'merge-state.quarantine.json')); if (qraw !== null) { const parsed = JSON.parse(qraw) as unknown; quarantineCount = Array.isArray(parsed) ? parsed.length : 0 } } catch { quarantineCount = -1 }
  rows.push({ key: 'quarantine', label: 'quarantine', status: quarantineCount < 0 ? 'unknown' : quarantineCount === 0 ? 'ok' : 'warn', detail: quarantineCount < 0 ? 'quarantine 不可读' : quarantineCount + ' 行待人工检查' })
  const holder = await readTreeLock(io, home).catch(() => null)
  rows.push({ key: 'tree-lock', label: 'tree lock', status: holder == null ? 'ok' : 'warn', detail: holder == null ? 'free' : 'holder pid=' + String(holder.pid) + ' epoch=' + String(holder.epoch) + ' token=' + holder.token.slice(0, 8) })
  rows.push({ key: 'backup', label: 'v2 backup', status: await io.exists(v2BackupPath(home)) ? 'ok' : 'unknown', detail: await io.exists(v2BackupPath(home)) ? 'merge-state.v2.bak.json' : 'no v2 backup (not migrated or already cleaned)' })
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
  rows.push({ key: 'consistency', label: '一致性', status: invalid.length === 0 ? 'ok' : 'warn', detail: invalid.length === 0 ? '无非法组合' : String(invalid.length) + ' 行需人工检查: ' + invalid.map(row => row.id).join(', ') })
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
