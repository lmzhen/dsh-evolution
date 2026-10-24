/** Startup replay for non-terminal commit journals: report only, never write skills. */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { CommitJournal } from './domain/commit-journal.ts'
import { writeJournal } from './domain/commit-journal-store.ts'
import { snapshotPath } from './commit-snapshot.ts'
import { readCommitReceipt } from './commit-receipt.ts'
import { readUnitEvidence } from '@deepseek-ai/dsh-evolution-core'

export interface CommitRecoveryReport {
  readonly runId: string
  readonly phase: CommitJournal['phase'] | 'unknown'
  readonly action: string
  readonly ok: boolean
  readonly target?: string
  readonly sources?: readonly string[]
  readonly journalPath?: string
  readonly snapshotPath?: string
  readonly unitId?: string
}

export async function recoverCommitJournals(
  io: EvolutionIoLike,
  home: string,
  now: number,
  isActive?: (runId: string) => boolean,
): Promise<readonly CommitRecoveryReport[]> {
  const dir = join(home, 'merge', 'journals')
  const reports: CommitRecoveryReport[] = []
  let files: string[] = []
  if (await io.exists(dir)) {
    try { files = (await io.list(dir)).filter(name => name.endsWith('.json')) } catch {
      reports.push({ runId: '(list)', phase: 'unknown', action: 'journal-list-failed', ok: false, journalPath: dir })
    }
  }
  for (const file of files) {
    const path = join(dir, file)
    try {
    let journal: CommitJournal
    try { journal = JSON.parse(await io.readText(path) ?? '') as CommitJournal } catch {
      reports.push({ runId: file.replace(/\.json$/, ''), phase: 'unknown', action: 'journal-unreadable', ok: false, journalPath: path })
      continue
    }
    if (isActive?.(journal.runId) === true) {
      reports.push({ runId: journal.runId, phase: journal.phase, action: 'skipped-active-run', ok: true, target: journal.target, sources: journal.sources, journalPath: path })
      continue
    }
    let receipt = null
    try { receipt = await readCommitReceipt(io, home, journal.runId, journal.target) } catch {
      reports.push({ runId: journal.runId, phase: journal.phase, action: 'receipt-read-failed', ok: false, target: journal.target, sources: journal.sources, journalPath: path })
      continue
    }
    if (receipt !== null) {
      await writeJournal(io, home, { ...journal, phase: 'committed', unitId: receipt.unitId, updatedAt: new Date(now).toISOString() })
      reports.push({ runId: journal.runId, phase: journal.phase, action: 'receipt-committed', ok: true, target: journal.target, sources: journal.sources, journalPath: path, unitId: receipt.unitId })
      continue
    }
    if (journal.phase === 'committed') {
      reports.push({ runId: journal.runId, phase: journal.phase, action: 'receipt-missing', ok: false, target: journal.target, sources: journal.sources, journalPath: path })
      continue
    }
    if (journal.phase === 'failed' || journal.phase === 'rolled-back') continue
    reports.push({
      runId: journal.runId, phase: journal.phase, action: 'manual-required', ok: false,
      target: journal.target, sources: journal.sources, journalPath: path, snapshotPath: snapshotPath(home, journal.runId),
    })
    } catch (error) {
      reports.push({ runId: file.replace(/\.json$/, ''), phase: 'unknown', action: 'recovery-error: ' + (error instanceof Error ? error.message : String(error)), ok: false, journalPath: path })
    }
  }
  const unitDir = join(home, 'merge', 'unit-journals')
  if (await io.exists(unitDir)) {
    let unitFiles: string[] = []
    try { unitFiles = (await io.list(unitDir)).filter(name => name.endsWith('.json')) } catch { /* no unit journals */ }
    for (const file of unitFiles) {
      const path = join(unitDir, file)
      try {
        const journal = JSON.parse(await io.readText(path) ?? '') as { unitId: string; runId: string; target: string; sources: readonly string[]; phase: string }
        const evidence = await readUnitEvidence(io, home, journal.unitId)
        if (evidence !== null) { reports.push({ runId: journal.runId, phase: 'committed', action: 'unit-committed', ok: true, target: journal.target, sources: journal.sources, journalPath: path, unitId: journal.unitId }); continue }
        if (journal.phase === 'committed') { reports.push({ runId: journal.runId, phase: 'committed', action: 'unit-evidence-missing', ok: false, target: journal.target, sources: journal.sources, journalPath: path, unitId: journal.unitId }); continue }
        if (journal.phase === 'failed' || journal.phase === 'rolled-back') continue
        reports.push({ runId: journal.runId, phase: journal.phase as CommitRecoveryReport['phase'], action: 'unit-manual-required', ok: false, target: journal.target, sources: journal.sources, journalPath: path, unitId: journal.unitId })
      } catch { reports.push({ runId: '(unit)', phase: 'unknown', action: 'unit-journal-unreadable', ok: false, journalPath: path }) }
    }
  }
  try { await io.writeText(join(home, 'merge', 'recovery.json'), JSON.stringify(reports, null, 2)) } catch { /* report file is best-effort; reports are still returned */ }
  return reports
}