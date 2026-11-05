/** Registration-owned workbench navigation state. No module-level singleton. */
export type WorkbenchView = 'history' | 'pending' | 'merge' | 'health' | 'diagnostics'

/** Read-only task counts supplied by the host; absent means "do not choose a landing". */
export interface WorkbenchTaskCounts {
  readonly pending: number
  readonly merge: number
}

export interface WorkbenchState {
  readonly view: WorkbenchView
  readonly selectedSkill?: string
  readonly focusRevision: number
  /** True only after a user chose a view; refresh/default landing must not overwrite it. */
  readonly explicitView?: boolean
}

export interface WorkbenchStore {
  getState(): WorkbenchState
  subscribe(listener: () => void): () => void
  /** A user choice: records explicit ownership of the view. */
  setView(view: WorkbenchView): void
  /** The default landing: only applies while the user has not chosen a view. */
  setDefaultView(view: WorkbenchView): void
  openHistory(skill?: string): void
  clearSelection(): void
}

/**
 * Resolve the first landing from task counts. Pending outranks merge; no task lands on history.
 * @param counts - read-only task counts.
 * @param hasMerge - whether the merge view is mounted.
 * @returns the view to open when the user has not chosen one.
 */
export function resolveDefaultView(counts: WorkbenchTaskCounts, hasMerge: boolean): WorkbenchView {
  if (counts.pending > 0) return 'pending'
  if (hasMerge && counts.merge > 0) return 'merge'
  return 'history'
}

export function createWorkbenchStore(initial: WorkbenchState = { view: 'history', focusRevision: 0, explicitView: false }): WorkbenchStore {
  let state = initial
  const listeners = new Set<() => void>()
  const emit = (next: WorkbenchState): void => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setView(view) { if (state.view !== view || state.explicitView !== true) emit({ ...state, view, explicitView: true }) },
    setDefaultView(view) { if (state.explicitView !== true && state.view !== view) emit({ ...state, view, explicitView: false }) },
    openHistory(skill) { emit({ view: 'history', ...(skill === undefined ? {} : { selectedSkill: skill }), focusRevision: state.focusRevision + 1, explicitView: true }) },
    clearSelection() { const { selectedSkill: _selected, ...rest } = state; emit({ ...rest, focusRevision: state.focusRevision + 1 }) },
  }
}
