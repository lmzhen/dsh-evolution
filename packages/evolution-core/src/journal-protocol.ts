/**
 * A journal protocol: the phases one multi-write operation records, which transitions it allows, and
 * what a restart may do from each phase (W9-commit-protocol §3.1).
 *
 * The commit and undo journals used to disagree: commit had a transition table and a recovery
 * decision but only reported it, while undo wrote a journal nobody read. Both now describe the same
 * shape, so a resumer can be written once against `JournalProtocol` instead of per operation.
 * @module @deepseek-ai/dsh-evolution-core/journal-protocol
 */

/** What a restart may do with a journal that stopped in this phase. */
export type JournalRecovery = 'retry' | 'continue' | 'done' | 'refuse'

export interface JournalProtocol<P extends string> {
  /** Every phase, in the order an operation normally passes through them. */
  readonly phases: readonly P[]
  /** Allowed transitions; an empty list marks a terminal phase. */
  readonly next: Readonly<Record<P, readonly P[]>>
  /** The restart decision for a journal left in `phase`. */
  recoveryOf(phase: P): JournalRecovery
}

