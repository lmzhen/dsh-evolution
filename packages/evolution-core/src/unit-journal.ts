/** G2 unit journal: intent/phase/checkpoint only, never evidence bodies. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { EvolutionIoLike } from './io.ts'

export const UNIT_JOURNAL_SCHEMA_VERSION = 1

export const UNIT_JOURNAL_PHASES = [
  'prepared',
  'target-pending',
  'target-written',
  'source-archiving',
  'sources-archived',
  'support-pending',
  'unit-written',
  'committed',
  'failed',
  'rolled-back',
] as const

export type UnitJournalPhase = typeof UNIT_JOURNAL_PHASES[number]

export interface UnitJournalCheckpoint {
  readonly source: string
  readonly phase: 'archived'
  readonly hash: string
  readonly at: number
}

export interface UnitJournal {
  readonly schemaVersion: typeof UNIT_JOURNAL_SCHEMA_VERSION
  readonly unitId: string
  readonly runId: string
  readonly planDigest: string
  readonly target: string
  readonly sources: readonly string[]
  readonly phase: UnitJournalPhase
  readonly storageKey: string
  readonly snapshotSha256: string
  readonly checkpoints?: readonly UnitJournalCheckpoint[]
  readonly updatedAt: number
}

export function unitJournalPath(home: string, unitId: string): string {
  return join(home, 'merge', 'unit-journals', createHash('sha256').update(unitId).digest('hex') + '.json')
}

export function unitJournalPhaseRank(phase: UnitJournalPhase): number {
  return UNIT_JOURNAL_PHASES.indexOf(phase)
}

export function assertUnitJournalTransition(from: UnitJournalPhase, to: UnitJournalPhase): void {
  if (to === 'failed' || to === 'rolled-back') return
  if (from === 'failed' || from === 'rolled-back' || from === 'committed') throw new Error('unit-journal-terminal:' + from)
  if (unitJournalPhaseRank(to) <= unitJournalPhaseRank(from)) throw new Error('unit-journal-nonmonotonic:' + from + '->' + to)
}

export async function writeUnitJournal(io: EvolutionIoLike, home: string, journal: UnitJournal): Promise<string> {
  const path = unitJournalPath(home, journal.unitId)
  const content = JSON.stringify(journal, null, 2) + '\n'
  if (io.transact !== undefined) await io.transact(path, () => content)
  else await io.writeText(path, content)
  return path
}

export async function readUnitJournal(io: EvolutionIoLike, home: string, unitId: string): Promise<UnitJournal | null> {
  const raw = await io.readText(unitJournalPath(home, unitId))
  if (raw === null) return null
  try { return JSON.parse(raw) as UnitJournal } catch { return null }
}
