/**
 * Merge doctor rows: state, pending, gate cache and staging are each probed read-only.
 * A missing file is an empty feature, not a failure; an unreadable file is a warning the
 * operator can act on. This module never repairs or writes.
 */
import { join } from 'node:path'
import { probeList, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { loadMergeState } from './state.ts'
import { countRows } from './status.ts'
import { stagingRoot } from './staging.ts'

export const MERGE_DOCTOR_SCHEMA_VERSION = 3

export interface MergeDoctorRow {
  readonly key: string
  readonly label: string
  readonly status: 'ok' | 'warn' | 'unknown'
  readonly detail: string
}

export async function mergeDoctor(io: EvolutionIoLike, home: string): Promise<readonly MergeDoctorRow[]> {
  const rows: MergeDoctorRow[] = []
  const loaded = await loadMergeState(io, home)
  const counts = countRows(loaded.state.rows)
  rows.push({
    key: 'state',
    label: '合并状态',
    status: loaded.note === undefined ? 'ok' : 'warn',
    detail: loaded.note ?? 'pairs ' + String(loaded.state.rows.length) + '；pending ' + String(counts.pending) + ' / retry ' + String(counts.retry) + ' / skipped ' + String(counts.skipped),
  })
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
  return rows
}
