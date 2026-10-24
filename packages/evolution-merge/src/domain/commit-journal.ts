/** Pure commit-journal phases for target-first merge. */
export type JournalPhase = 'prepared' | 'target-written' | 'sources-archived' | 'committed' | 'rolled-back' | 'failed'

export interface CommitJournal {
  readonly runId: string
  readonly unitId?: string
  readonly target: string
  readonly create: boolean
  readonly sources: readonly string[]
  readonly phase: JournalPhase
  readonly updatedAt: string
}

const NEXT: Record<JournalPhase, readonly JournalPhase[]> = {
  prepared: ['committed', 'target-written', 'failed'],
  'target-written': ['sources-archived', 'rolled-back', 'failed'],
  'sources-archived': ['committed', 'rolled-back', 'failed'],
  committed: [],
  'rolled-back': [],
  failed: [],
}

export function advanceJournal(journal: CommitJournal, phase: JournalPhase, at: string): CommitJournal {
  if (!NEXT[journal.phase].includes(phase)) throw new Error('invalid journal transition: ' + journal.phase + ' -> ' + phase)
  return { ...journal, phase, updatedAt: at }
}

export type JournalRecovery = 'none' | 'retry-commit' | 'rollback-target' | 'rollback-sources' | 'refuse'

/** What a restart may do with the last durable phase. */
export function recoveryFor(journal: CommitJournal): JournalRecovery {
  switch (journal.phase) {
    case 'prepared': return 'retry-commit'
    case 'target-written': return 'rollback-target'
    case 'sources-archived': return 'rollback-sources'
    case 'committed':
    case 'rolled-back':
    case 'failed': return 'none'
    default: return 'refuse'
  }
}
