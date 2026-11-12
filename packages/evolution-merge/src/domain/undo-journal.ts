import { readTextOrNull } from './read-probe.ts'
/** Per-run undo journal: one pair at a time, durable phase before each write. */
import { join } from 'node:path'
import { transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { JournalProtocol, JournalRecovery } from '@deepseek-ai/dsh-evolution-core'
export type UndoPairPhase = 'pending' | 'restore-target' | 'restore-source' | 'receipt' | 'pair-index' | 'run-meta' | 'done'
export interface UndoPairState { readonly pairKey: string; readonly unitId: string; readonly phase: UndoPairPhase; readonly message?: string }
export interface UndoJournal { readonly version: 1; readonly runId: string; readonly phase: 'prepared' | 'running' | 'settled'; readonly pairs: readonly UndoPairState[]; readonly updatedAt: string }

/**
 * The undo journal's protocol (W9-commit-protocol §3.1): `pair-index` and `run-meta` are explicit
 * phases, because "the receipt was written but the pair index was not" is exactly the state a
 * restart has to recognise.
 */
export const UNDO_PAIR_PROTOCOL: JournalProtocol<UndoPairPhase> = {
  phases: ['pending', 'restore-target', 'restore-source', 'receipt', 'pair-index', 'run-meta', 'done'],
  next: {
    pending: ['restore-target', 'receipt', 'done'],
    'restore-target': ['restore-source', 'receipt'],
    'restore-source': ['receipt'],
    receipt: ['pair-index'],
    'pair-index': ['run-meta'],
    'run-meta': ['done'],
    done: [],
  },
  recoveryOf(phase: UndoPairPhase): JournalRecovery {
    switch (phase) {
      case 'done': return 'done'
      case 'pending': return 'retry'
      case 'restore-target':
      case 'restore-source':
      case 'receipt':
      case 'pair-index':
      case 'run-meta': return 'continue'
      default: return 'refuse'
    }
  },
}

export function undoJournalPath(home: string, runId: string): string { return join(home, 'merge', 'undo-journal', encodeURIComponent(runId) + '.json') }
export async function readUndoJournal(io: EvolutionIoLike, home: string, runId: string): Promise<UndoJournal | null> {
  const raw = await readTextOrNull(io, undoJournalPath(home, runId))
  if (raw === null) return null
  try { return JSON.parse(raw) as UndoJournal } catch { return null }
}
export async function writeUndoJournal(io: EvolutionIoLike, home: string, journal: UndoJournal): Promise<void> {
  await transactIo(io, undoJournalPath(home, journal.runId), () => JSON.stringify(journal, null, 2) + '\n')
}
