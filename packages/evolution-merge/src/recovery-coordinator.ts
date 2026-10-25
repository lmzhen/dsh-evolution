/** Batch 2c unit-journal recovery coordinator. UnitTransaction remains the only skill writer. */
import { join } from 'node:path'
import type { EvolutionIoLike, UnitJournal, UnitTransaction } from '@deepseek-ai/dsh-evolution-core'
import { readUnitEvidence } from '@deepseek-ai/dsh-evolution-core'
import { evidenceSha256 } from './domain/evidence-hash.ts'
import { projectRecoveredUnit } from './recovery-projection.ts'

export type RecoveryBranch = 'A' | 'B' | 'C' | 'D'
export interface RecoveryReport {
  readonly unitId: string
  readonly runId: string
  readonly phase: string
  readonly branch: RecoveryBranch
  readonly action: 'rollback' | 'rollForward' | 'finalize' | 'blocked' | 'none'
  readonly ok: boolean
  readonly code?: string | undefined
  readonly message?: string | undefined
  readonly evidenceSha256?: string
}
const branchOf = (phase: string): RecoveryBranch => {
  if (phase === 'prepared' || phase === 'target-pending') return 'A'
  if (phase === 'target-written' || phase === 'support-pending' || phase === 'source-archiving') return 'B'
  if (phase === 'sources-archived' || phase === 'unit-written') return 'C'
  if (phase === 'committed') return 'D'
  return 'A'
}
export async function recoverCommitUnits(options: {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly unit: UnitTransaction
  readonly now: () => number
  readonly isActive?: (runId: string) => boolean
  readonly runs?: {
    settle(id: string, outcome: { state: 'succeeded' | 'failed' | 'cancelled'; resultRef?: string; failure?: string }): Promise<void>
    settleRecovered?(id: string, outcome: { state: 'succeeded' | 'failed' | 'cancelled'; resultRef?: string; failure?: string }): Promise<boolean>
  }
  readonly onProjectionPhase?: (phase: string) => void | Promise<void>
}): Promise<readonly RecoveryReport[]> {
  const dir = join(options.home, 'merge', 'unit-journals')
  if (!(await options.io.exists(dir))) return []
  let files: string[] = []
  try { files = (await options.io.list(dir)).filter(name => name.endsWith('.json')) } catch { return [] }
  const reports: RecoveryReport[] = []
  for (const file of files.sort()) {
    let journal: UnitJournal | null = null
    try { journal = JSON.parse(await options.io.readText(join(dir, file)) ?? '') as UnitJournal } catch { journal = null }
    if (journal === null || typeof journal.unitId !== 'string') continue
    if (options.isActive?.(journal.runId) === true) { reports.push({ unitId: journal.unitId, runId: journal.runId, phase: journal.phase, branch: branchOf(journal.phase as string), action: 'none', ok: true, code: 'skipped-active-run' }); continue }
    const evidence = await readUnitEvidence(options.io, options.home, journal.unitId)
    const branch = branchOf(journal.phase)
    if (journal.phase as string === 'committed' || evidence !== null || journal.phase as string === 'unit-written' || journal.phase as string === 'sources-archived') {
      const result = await options.unit.finalize(journal.unitId)
      if (result.ok) {
        let projection: Awaited<ReturnType<typeof projectRecoveredUnit>>
        try { projection = await projectRecoveredUnit({ io: options.io, home: options.home, runId: journal.runId, unitId: journal.unitId, evidence: result.evidence, now: options.now, ...(options.runs === undefined ? {} : { runs: options.runs }), ...(options.onProjectionPhase === undefined ? {} : { onPhase: options.onProjectionPhase }) }) } catch (error) { projection = { ok: false, action: 'projection-threw', message: error instanceof Error ? error.message : String(error) } }
        if (!projection.ok) reports.push({ unitId: journal.unitId, runId: journal.runId, phase: journal.phase, branch, action: 'blocked', ok: false, code: 'projection-failed', message: projection.message })
        else reports.push({ unitId: journal.unitId, runId: journal.runId, phase: journal.phase, branch, action: 'finalize', ok: true, evidenceSha256: evidenceSha256(result.evidence) })
        continue
      }
      reports.push({ unitId: journal.unitId, runId: journal.runId, phase: journal.phase, branch, action: 'finalize', ok: false, code: result.code, message: result.message })
      continue
    }
    if (branch === 'A') {
      const result = await options.unit.rollback({ unitId: journal.unitId, reason: 'startup recovery branch A' })
      reports.push({ unitId: journal.unitId, runId: journal.runId, phase: journal.phase, branch, action: 'rollback', ok: result.ok, ...(result.ok ? {} : { code: result.code, message: result.message }) })
      continue
    }
    if (branch === 'B') {
      const result = await options.unit.rollForward(journal.unitId)
      if (result.ok) {
        let projection: Awaited<ReturnType<typeof projectRecoveredUnit>>
        try { projection = await projectRecoveredUnit({ io: options.io, home: options.home, runId: journal.runId, unitId: journal.unitId, evidence: result.evidence, now: options.now, ...(options.runs === undefined ? {} : { runs: options.runs }), ...(options.onProjectionPhase === undefined ? {} : { onPhase: options.onProjectionPhase }) }) } catch (error) { projection = { ok: false, action: 'projection-threw', message: error instanceof Error ? error.message : String(error) } }
        reports.push({ unitId: journal.unitId, runId: journal.runId, phase: journal.phase, branch, action: projection.ok ? 'rollForward' : 'blocked', ok: projection.ok, ...(projection.ok ? { evidenceSha256: evidenceSha256(result.evidence) } : { code: 'projection-failed', message: projection.message }) })
      } else reports.push({ unitId: journal.unitId, runId: journal.runId, phase: journal.phase, branch, action: 'rollForward', ok: false, code: result.code, message: result.message })
      continue
    }
    reports.push({ unitId: journal.unitId, runId: journal.runId, phase: journal.phase, branch, action: 'blocked', ok: false, code: 'unit-recovery-blocked' })
  }
  return reports
}
