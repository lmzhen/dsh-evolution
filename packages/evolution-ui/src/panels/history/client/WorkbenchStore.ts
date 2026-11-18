/** Registration-owned workbench navigation state. No module-level singleton. */
export type WorkbenchView = 'history' | 'data' | 'pending' | 'merge' | 'health' | 'diagnostics'

/** Read-only task counts supplied by the host; absent means "do not choose a landing". */
export interface WorkbenchTaskCounts {
  readonly pending: number
  readonly merge: number
}

/** The data overview's presentation state; it survives a trip into a skill. */
export interface WorkbenchDataState {
  readonly query: string
  readonly filter: 'all' | 'attention' | 'recent'
  readonly sort: { readonly key: string; readonly dir: 'asc' | 'desc' }
  readonly scrollTop: number
}

const DEFAULT_DATA_STATE: WorkbenchDataState = Object.freeze({
  query: '',
  filter: 'all',
  sort: { key: 'bodyChars', dir: 'desc' as const },
  scrollTop: 0,
})
export interface WorkbenchState {
  readonly view: WorkbenchView
  readonly selectedSkill?: string
  /** The history list's search text; owned here so list selection and return restore it. */
  readonly historyQuery: string
  /** Bumped on every explicit open, including a repeated same-skill navigation. */
  readonly selectionRevision: number
  /** Data overview query/filter/sort/scroll; one source for the table. */
  readonly data: WorkbenchDataState
  /** True only after a user chose a view; refresh/default landing must not overwrite it. */
  readonly explicitView?: boolean
  /** Set when the detail page was opened from the data table; the detail page can go back. */
  readonly origin?: 'data' | 'list'
}

export interface WorkbenchStore {
  getState(): WorkbenchState
  subscribe(listener: () => void): () => void
  /** A user choice: records explicit ownership of the view. */
  setView(view: WorkbenchView): void
  /** The default landing: only applies while the user has not chosen a view. */
  setDefaultView(view: WorkbenchView): void
  /** Open a skill and remember whether the data table or the history list started the trip. */
  openHistory(skill?: string, origin?: 'data' | 'list'): void
  /** Return from a detail opened by the data table; the table stays mounted and keeps its state. */
  backToData(): void
  /** Return to the list from a narrow detail page. */
  backToList(): void
  setHistoryQuery(query: string): void
  setDataView(patch: Partial<WorkbenchDataState>): void
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

export function createWorkbenchStore(initial: WorkbenchState = {
  view: 'history',
  historyQuery: '',
  selectionRevision: 0,
  data: DEFAULT_DATA_STATE,
  explicitView: false,
}): WorkbenchStore {
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
    setView(view) {
      if (view === 'history' && state.view !== 'history') {
        const { selectedSkill: _selected, origin: _origin, ...rest } = state
        emit({ ...rest, view, explicitView: true })
        return
      }
      if (state.view !== view || state.explicitView !== true) {
        const { origin: _origin, ...rest } = state
        emit({ ...rest, view, explicitView: true })
      }
    },
    setDefaultView(view) { if (state.explicitView !== true && state.view !== view) emit({ ...state, view, explicitView: false }) },
    openHistory(skill, origin) {
      const { selectedSkill: _selected, origin: _origin, ...rest } = state
      emit(skill === undefined
        ? { ...rest, view: 'history', selectionRevision: state.selectionRevision + 1, explicitView: true }
        : {
          ...rest,
          view: 'history',
          selectedSkill: skill,
          ...(origin === undefined ? {} : { origin }),
          selectionRevision: state.selectionRevision + 1,
          explicitView: true,
        })
    },
    backToData() {
      const { origin: _origin, ...rest } = state
      emit({ ...rest, view: 'data', explicitView: true })
    },
    backToList() {
      const { origin: _origin, selectedSkill: _selected, ...rest } = state
      emit({ ...rest, view: 'history', explicitView: true })
    },
    setHistoryQuery(query) {
      if (state.historyQuery !== query) emit({ ...state, historyQuery: query })
    },
    setDataView(patch) {
      const next = { ...state.data, ...patch }
      if (next.query === state.data.query && next.filter === state.data.filter
        && next.sort.key === state.data.sort.key && next.sort.dir === state.data.sort.dir
        && next.scrollTop === state.data.scrollTop) return
      emit({ ...state, data: next })
    },
  }
}
