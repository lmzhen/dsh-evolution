import { readTextOrNull } from './read-probe.ts'
/**
 * Explicit merge reconciliation: the ONE writer of row-state convergence.
 *
 * Reconcile owns the durable corrections that used to be scattered across startup
 * (skipped TTL expiry, approved+reserved continuation) and reports them in
 * `<home>/merge/reconcile.json`. Snapshots and all four GET routes stay read-only:
 * they may DERIVE a fact (an expired stage, a source that disappeared) but never
 * persist it; only this module and the command lifecycle write rows.
 */
import { join } from 'node:path'
import { transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { readV4Readiness } from './schema4.ts'
import { pairLedger } from './pair-ledger.ts'
import { planSkippedExpiry } from './skipped-expiry.ts'
import { presentStage, readAllStages, readStageTree, writeStageIndex, type StageEntry } from './stage-aggregate.ts'
import { pendingExpiry, type LiveRowFacts } from './live-facts.ts'
import type { V4Row } from './row-v4.ts'

export const RECONCILE_REPORT_VERSION = 1

export type ReconcileActionKind = 'skipped-expired' | 'pending-expired' | 'approved-fused' | 'source-gone'
export type ReconcileActionCode = 'skipped-ttl' | 'target-taken' | 'source-changed' | 'stage-present' | 'stage-lost' | 'stage-expired' | 'source-gone'

/** One durable row transition reconcile performed. */
export interface ReconcileAction {
  readonly kind: ReconcileActionKind
  readonly rowId: string
  readonly from: V4Row['state']
  readonly to: V4Row['state'] | 'removed'
  readonly code: ReconcileActionCode
  readonly detail?: string
}

/** The persisted report a CLI/doctor consumer reads; `state:'blocked'` means nothing was written. */
export interface ReconcileReport {
  readonly version: typeof RECONCILE_REPORT_VERSION
  readonly at: number
  readonly state: 'ok' | 'blocked'
  readonly code?: string
  readonly message?: string
  readonly actions: readonly ReconcileAction[]
  readonly notes: readonly string[]
}

export interface ReconcileOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly now: () => number
  /** Skipped rows past this TTL get their durable expiredAt stamp. */
  readonly ttlDays?: number
  /** Live managed skill names. When supplied, active rows whose sources vanished are cleared. */
  readonly managed?: ReadonlySet<string>
  /** Live revision facts; when supplied, pending rows that went stale are stamped expired. */
  readonly live?: LiveRowFacts
}

export function reconcileReportPath(home: string): string {
  return join(home, 'merge', 'reconcile.json')
}

/** Read the last reconcile report; a malformed report is absent, never a throw. */
export async function readReconcileReport(io: EvolutionIoLike, home: string): Promise<ReconcileReport | null> {
  const raw = await readTextOrNull(io, reconcileReportPath(home))
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ReconcileReport>
    if (parsed.version !== RECONCILE_REPORT_VERSION || (parsed.state !== 'ok' && parsed.state !== 'blocked')) return null
    if (typeof parsed.at !== 'number' || !Array.isArray(parsed.actions)) return null
    return parsed as ReconcileReport
  } catch { return null }
}

function blockedReport(now: number, code: string, message: string): ReconcileReport {
  return { version: RECONCILE_REPORT_VERSION, at: now, state: 'blocked', code, message, actions: [], notes: ['reconcile wrote nothing: the merge state is not readable'] }
}

/** One stage's tree can still serve the round-2 author. */
async function stageUsable(io: EvolutionIoLike, home: string, entry: StageEntry, now: number): Promise<boolean> {
  if (entry.state !== 'reserved' && entry.state !== 'present') return false
  if (entry.expiresAt <= now) return false
  return (await readStageTree(io, home, entry.ref).catch(() => ({ kind: 'absent' as const }))).kind === 'present'
}

/**
 * Converge the row layer once, atomically, then persist the report.
 * A blocked state writes no rows and no report; every other run is idempotent.
 */
export async function reconcileMergeState(options: ReconcileOptions): Promise<ReconcileReport> {
  const now = options.now()
  const ttlDays = options.ttlDays ?? 0
  const ready = await readV4Readiness(options.io, options.home)
  if (!ready.ok) return blockedReport(now, ready.code, ready.message)
  const stages = await readAllStages(options.io, options.home)
  const byRow = new Map(stages.map(entry => [entry.rowId, entry] as const))
  const usable = new Map<string, boolean>()
  const expiredStages: StageEntry[] = []
  for (const entry of stages) {
    if (entry.state !== 'reserved' && entry.state !== 'present') continue
    if (entry.expiresAt <= now) { expiredStages.push(entry); continue }
    usable.set(entry.rowId, await stageUsable(options.io, options.home, entry, now))
  }
  const actions: ReconcileAction[] = []
  const promote: StageEntry[] = []
  await pairLedger(options.io, options.home).transact(tx => {
    for (const row of [...tx.rows()]) {
      if (row.state === 'skipped' && ttlDays > 0 && planSkippedExpiry([row], ttlDays, now).length === 1) {
        const current = tx.rows().find(item => item.id === row.id)
        if (current !== undefined && tx.transition(row.id, { type: 'mark-skipped-expired', at: now }, current.version).ok) {
          actions.push({ kind: 'skipped-expired', rowId: row.id, from: 'skipped', to: 'skipped', code: 'skipped-ttl' })
        }
        continue
      }
      if (row.state === 'pending' && row.expired === undefined && options.live !== undefined) {
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined || current.state !== 'pending' || current.expired !== undefined) continue
        const kind = pendingExpiry(current, options.live)
        if (kind === null) continue
        if (kind === 'source-gone') {
          const removed = tx.remove(row.id, 'superseded', undefined, current.version)
          if (removed.ok) actions.push({ kind: 'source-gone', rowId: row.id, from: 'pending', to: 'removed', code: 'source-gone', detail: [row.a, row.b].filter(name => !options.live?.managed(name)).join(', ') })
          continue
        }
        const moved = tx.transition(row.id, { type: 'expired', kind }, current.version)
        if (moved.ok) actions.push({ kind: 'pending-expired', rowId: row.id, from: 'pending', to: 'pending', code: kind })
        continue
      }
      if (row.state !== 'approved') continue
      const current = tx.rows().find(item => item.id === row.id)
      if (current === undefined || current.state !== 'approved') continue
      const entry = byRow.get(row.id)
      if (usable.get(row.id) === true) {
        const moved = tx.transition(row.id, { type: 'staged', ...(entry === undefined ? {} : { stagingRef: entry.ref, stagingExpiresAt: entry.expiresAt }) }, current.version)
        if (moved.ok) {
          actions.push({ kind: 'approved-fused', rowId: row.id, from: 'approved', to: 'fuse', code: 'stage-present' })
          if (entry !== undefined && entry.state === 'reserved') promote.push(entry)
        }
        continue
      }
      const failure = { stage: 'author' as const, code: 'stage-lost', message: 'stage tree is missing, expired, or lost before round2', retryable: true, retryFrom: 'agent2' as const }
      const moved = tx.transition(row.id, { type: 'failed', failure }, current.version)
      if (moved.ok) actions.push({ kind: 'approved-fused', rowId: row.id, from: 'approved', to: 'fuse', code: 'stage-lost' })
    }
    if (options.managed !== undefined) {
      for (const row of [...tx.rows()]) {
        if (row.state === 'skipped') continue
        if (options.managed.has(row.a) && options.managed.has(row.b)) continue
        const current = tx.rows().find(item => item.id === row.id)
        if (current === undefined) continue
        const removed = tx.remove(row.id, 'superseded', undefined, current.version)
        if (removed.ok) actions.push({ kind: 'source-gone', rowId: row.id, from: current.state, to: 'removed', code: 'source-gone', detail: [row.a, row.b].filter(name => !options.managed?.has(name)).join(', ') })
      }
    }
    return actions.length
  })
  for (const entry of promote) {
    try { await presentStage(options.io, options.home, entry) } catch { /* the stage index stays reserved; the report still names the row */ }
  }
  // NFR-06: the index (the record the read face and the resume path consult) must agree
  // with the read-side derivation that an expired stage is no longer present.
  for (const entry of expiredStages) {
    try { await writeStageIndex(options.io, options.home, { ...entry, state: 'expired' }) } catch { /* report keeps the read-side verdict */ }
  }
  const notes: string[] = []
  if (expiredStages.length > 0) notes.push(String(expiredStages.length) + ' expired stage(s) marked in the index')
  if (options.managed === undefined) notes.push('source-gone convergence skipped: no live library was supplied')
  if (ttlDays <= 0) notes.push('skipped TTL disabled (mergeSkippedTtlDays=0)')
  const report: ReconcileReport = { version: RECONCILE_REPORT_VERSION, at: now, state: 'ok', actions, notes }
  await transactIo(options.io, reconcileReportPath(options.home), () => JSON.stringify(report, null, 2) + '\n')
  return report
}

/** One-line text face for the CLI/doctor consumers. */
export function formatReconcileReport(report: ReconcileReport): string {
  if (report.state === 'blocked') return 'merge reconcile: blocked ' + (report.code ?? 'merge-state-blocked') + ' — ' + (report.message ?? 'state is not readable')
  const counts = new Map<string, number>()
  for (const action of report.actions) counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1)
  const summary = counts.size === 0 ? 'no actions' : [...counts].map(([kind, count]) => kind + ' ' + String(count)).join(', ')
  const lines = ['merge reconcile: ' + summary + ' (at ' + new Date(report.at).toISOString() + ')']
  for (const action of report.actions) lines.push('- ' + action.rowId + ': ' + action.from + ' → ' + action.to + ' [' + action.code + ']' + (action.detail === undefined ? '' : ' ' + action.detail))
  for (const note of report.notes) lines.push('note: ' + note)
  return lines.join('\n')
}
