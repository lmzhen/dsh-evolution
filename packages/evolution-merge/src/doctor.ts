/**
 * Merge doctor rows: state, pending, gate cache and staging are each probed read-only.
 * A missing file is an empty feature, not a failure; an unreadable file is a warning the
 * operator can act on. This module never repairs or writes.
 */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { loadMergeState } from './state.ts'
import { countRows } from './status.ts'
import { loadGateCache } from './gate-cache.ts'
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
  const cache = await loadGateCache(io, home)
  rows.push({
    key: 'gate-cache',
    label: '闸门缓存',
    status: cache.note === undefined ? 'ok' : 'warn',
    detail: cache.note ?? String(cache.cache.size) + ' 条',
  })
  const runsDir = join(home, 'merge', 'runs')
  const listed = await io.list(runsDir).catch(() => null)
  rows.push({
    key: 'staging',
    label: '暂存树',
    status: listed === null ? 'unknown' : 'ok',
    detail: listed === null ? '无法列出 ' + runsDir : String(listed.length) + ' 个 run 目录',
  })
  rows.push({
    key: 'staging-path',
    label: '暂存路径',
    status: 'ok',
    detail: stagingRoot(home, '<runId>'),
  })
  return rows
}
