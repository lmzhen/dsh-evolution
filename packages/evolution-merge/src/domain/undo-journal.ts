import { readTextOrNull } from './read-probe.ts'
/** Per-run undo journal: one pair at a time, durable phase before each write. */
import { join } from 'node:path'
import { transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
export type UndoPairPhase = 'pending' | 'restore-target' | 'restore-source' | 'receipt' | 'done'
export interface UndoPairState { readonly pairKey: string; readonly unitId: string; readonly phase: UndoPairPhase; readonly message?: string }
export interface UndoJournal { readonly version: 1; readonly runId: string; readonly phase: 'prepared' | 'running' | 'settled'; readonly pairs: readonly UndoPairState[]; readonly updatedAt: string }
export function undoJournalPath(home: string, runId: string): string { return join(home, 'merge', 'undo-journal', encodeURIComponent(runId) + '.json') }
export async function readUndoJournal(io: EvolutionIoLike, home: string, runId: string): Promise<UndoJournal | null> {
  const raw = await readTextOrNull(io, undoJournalPath(home, runId))
  if (raw === null) return null
  try { return JSON.parse(raw) as UndoJournal } catch { return null }
}
export async function writeUndoJournal(io: EvolutionIoLike, home: string, journal: UndoJournal): Promise<void> {
  await transactIo(io, undoJournalPath(home, journal.runId), () => JSON.stringify(journal, null, 2) + '\n')
}
