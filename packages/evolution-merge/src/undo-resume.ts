/**
 * Resume an interrupted merge undo from its journal (W9-commit-protocol §3.2).
 *
 * The pass itself is idempotent: a pair whose target or sources already hold their pre-commit
 * content is planned from the missing side only. What a resume needs from the journal is therefore
 * not step replay but a decision — is there anything left, and may it continue? That is what this
 * entry point answers before delegating to the same pass.
 * @module @deepseek-ai/dsh-evolution-merge/undo-resume
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { readUndoJournal } from './domain/undo-journal.ts'
import { runUndoOperation, type UndoResult } from './undo-operation.ts'
import type { MergeUndoPort } from './undo-merge.ts'

export interface ResumeUndoOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly port: MergeUndoPort
  readonly now: () => number
  readonly pairKey?: string
  readonly target?: string
  readonly finalizeUnit?: (unitId: string) => Promise<{ readonly ok: boolean; readonly message?: string }>
  readonly onPhase?: (phase: string, pairKey: string) => void | Promise<void>
  readonly fence?: { run<T>(body: () => Promise<T>): Promise<T> }
}

/**
 * Continue an undo that stopped in a non-terminal phase.
 * @param options - the same inputs the original pass took.
 * @returns the pass result, or a refusal when there is nothing to resume.
 */
export async function resumeUndo(options: ResumeUndoOptions): Promise<UndoResult> {
  const journal = await readUndoJournal(options.io, options.home, options.runId)
  if (journal === null) {
    return { ok: false, code: 'undo-partial-state', message: 'no readable undo journal for run ' + options.runId + '; nothing to resume', undone: [] }
  }
  if (journal.pairs.every(pair => pair.phase === 'done')) {
    return { ok: true, message: 'undo already settled: ' + options.runId, undone: [] }
  }
  return await runUndoOperation(options)
}
