/** Registration-owned workbench navigation state. No module-level singleton. */
export type WorkbenchView = 'history' | 'pending' | 'merge' | 'health' | 'diagnostics'

export interface WorkbenchState {
  readonly view: WorkbenchView
  readonly selectedSkill?: string
  readonly focusRevision: number
}

export interface WorkbenchStore {
  getState(): WorkbenchState
  subscribe(listener: () => void): () => void
  setView(view: WorkbenchView): void
  openHistory(skill?: string): void
  clearSelection(): void
}

export function createWorkbenchStore(initial: WorkbenchState = { view: 'history', focusRevision: 0 }): WorkbenchStore {
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
    setView(view) { if (state.view !== view) emit({ ...state, view }) },
    openHistory(skill) { emit({ view: 'history', ...(skill === undefined ? {} : { selectedSkill: skill }), focusRevision: state.focusRevision + 1 }) },
    clearSelection() { const { selectedSkill: _selected, ...rest } = state; emit({ ...rest, focusRevision: state.focusRevision + 1 }) },
  }
}
