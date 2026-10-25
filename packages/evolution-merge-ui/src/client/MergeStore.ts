/** Keyed read store for the merge panel. It never writes and keeps DOM state out. */
import type { MergeBody, MergeFailure, MergeHistoryItem, MergeOutcome, MergeQueue, MergeRowView, MergeViewPayload, QueuePage } from './api.ts'

export interface MergeSource {
  view(): Promise<MergeOutcome<MergeViewPayload>>
  rows(queue: MergeQueue, cursor?: string, expiredOnly?: boolean): Promise<MergeOutcome<QueuePage>>
  body(name: string, side: 'live' | 'archive'): Promise<MergeOutcome<MergeBody>>
  history(): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>>
}
export type QueueStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export interface QueueState {
  status: QueueStatus
  rows: MergeRowView[]
  nextCursor?: string | undefined
  failure?: MergeFailure | undefined
}
export type OverlayState =
  | { kind: 'body'; name: string; side: 'live' | 'archive'; status: 'loading' | 'ready' | 'error'; body?: MergeBody; failure?: MergeFailure }
  | { kind: 'history'; status: 'loading' | 'ready' | 'error'; items?: MergeHistoryItem[]; failure?: MergeFailure }
export interface StoreSnapshot {
  view: MergeViewPayload
  viewState: 'loading' | 'ready' | 'error' | 'blocked'
  viewFailure?: MergeFailure | undefined
  queue: MergeQueue
  expiredOnly: boolean
  current: QueueState
  overlay?: OverlayState | undefined
}

const emptyView = (): MergeViewPayload => ({
  counts: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0,
  tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 0 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }],
  commands: [], startCommands: { scan: '/evolution merge scan', pair: '/evolution merge pair <a> <b>' },
  notes: [], degraded: false, approval: { mergeApproval: false },
})
const keyOf = (queue: MergeQueue, expiredOnly: boolean): string => queue + ':' + (expiredOnly ? '1' : '0')
const loadingQueue = (): QueueState => ({ status: 'loading', rows: [] })

export interface MergeStoreInitial {
  view?: MergeViewPayload
  rows?: MergeRowView[]
  queue?: MergeQueue
  expiredOnly?: boolean
}

export class MergeStore {
  private readonly source: MergeSource
  private readonly listeners = new Set<() => void>()
  private readonly cache = new Map<string, QueueState>()
  private readonly tokens = new Map<string, number>()
  private viewToken = 0
  private overlayToken = 0
  private snapshot: StoreSnapshot
  private started = false
  private disposed = false

  constructor(source: MergeSource, initial: MergeStoreInitial = {}) {
    this.source = source
    const queue = initial.queue ?? 'pending'
    const expiredOnly = queue === 'pending' ? (initial.expiredOnly ?? false) : false
    const initialRows = initial.rows
    const current: QueueState = initialRows === undefined
      ? loadingQueue()
      : { status: initialRows.length === 0 ? 'empty' : 'ready', rows: initialRows }
    if (initialRows !== undefined) this.cache.set(keyOf(queue, expiredOnly), current)
    this.snapshot = {
      view: initial.view ?? emptyView(),
      viewState: initial.view === undefined ? 'loading' : 'ready',
      queue,
      expiredOnly,
      current,
    }
  }

  readonly read = (): StoreSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    if (this.disposed) return
    for (const listener of this.listeners) listener()
  }
  private set(next: StoreSnapshot): void {
    this.snapshot = next
    this.emit()
  }
  private isCurrent(queue: MergeQueue, expiredOnly: boolean): boolean {
    return this.snapshot.queue === queue && this.snapshot.expiredOnly === expiredOnly
  }

  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    void this.loadView()
    void this.loadQueue(this.snapshot.queue, this.snapshot.expiredOnly)
  }

  async loadView(showLoading = true): Promise<void> {
    const token = ++this.viewToken
    if (showLoading) this.set({ ...this.snapshot, viewState: 'loading', viewFailure: undefined })
    const outcome = await this.source.view()
    if (this.disposed || token !== this.viewToken) return
    if (!outcome.ok) {
      if (outcome.failure.kind === 'blocked') {
        this.set({ ...this.snapshot, viewState: 'blocked', viewFailure: outcome.failure, current: { status: 'idle', rows: [] } })
        for (const key of this.cache.keys()) this.cache.set(key, { status: 'idle', rows: [] })
        return
      }
      this.set({ ...this.snapshot, viewState: 'error', viewFailure: outcome.failure })
      return
    }
    this.set({ ...this.snapshot, view: outcome.payload, viewState: 'ready', viewFailure: undefined })
  }

  async loadQueue(queue: MergeQueue, expiredOnly: boolean, cursor?: string): Promise<void> {
    const key = keyOf(queue, expiredOnly)
    const token = (this.tokens.get(key) ?? 0) + 1
    this.tokens.set(key, token)
    const previous = this.cache.get(key)
    const next: QueueState = cursor === undefined ? { status: 'loading', rows: [] } : { status: 'loading', rows: previous?.rows ?? [], ...(previous?.nextCursor === undefined ? {} : { nextCursor: previous.nextCursor }) }
    this.cache.set(key, next)
    if (this.isCurrent(queue, expiredOnly)) this.set({ ...this.snapshot, current: next })
    const outcome = await this.source.rows(queue, cursor, queue === 'pending' && expiredOnly)
    if (this.disposed || token !== this.tokens.get(key)) return
    if (!outcome.ok) {
      if (outcome.failure.kind === 'blocked') {
        this.set({ ...this.snapshot, viewState: 'blocked', viewFailure: outcome.failure, current: { status: 'idle', rows: [] } })
        return
      }
      const failed: QueueState = { status: 'error', rows: [], failure: outcome.failure }
      this.cache.set(key, failed)
      if (this.isCurrent(queue, expiredOnly)) this.set({ ...this.snapshot, current: failed })
      return
    }
    const items = cursor === undefined ? outcome.payload.items : [...(previous?.rows ?? []), ...outcome.payload.items]
    const ready: QueueState = { status: items.length === 0 ? 'empty' : 'ready', rows: items, ...(outcome.payload.nextCursor === undefined ? {} : { nextCursor: outcome.payload.nextCursor }) }
    this.cache.set(key, ready)
    if (this.isCurrent(queue, expiredOnly)) this.set({ ...this.snapshot, current: ready, expiredOnly, queue })
  }

  select(queue: MergeQueue): void {
    const expiredOnly = queue === 'pending' ? this.snapshot.expiredOnly : false
    if (queue === this.snapshot.queue && expiredOnly === this.snapshot.expiredOnly) return
    const key = keyOf(queue, expiredOnly)
    const cached = this.cache.get(key)
    const current = cached ?? loadingQueue()
    this.set({ ...this.snapshot, queue, expiredOnly, current, overlay: undefined })
    if (cached === undefined) void this.loadQueue(queue, expiredOnly)
  }

  toggleExpired(): void {
    if (this.snapshot.queue !== 'pending') return
    const expiredOnly = !this.snapshot.expiredOnly
    const key = keyOf('pending', expiredOnly)
    const cached = this.cache.get(key)
    const current = cached ?? loadingQueue()
    this.set({ ...this.snapshot, expiredOnly, current, overlay: undefined })
    if (cached === undefined) void this.loadQueue('pending', expiredOnly)
  }

  refresh(): void {
    if (this.disposed) return
    void this.loadView(true)
    void this.loadQueue(this.snapshot.queue, this.snapshot.expiredOnly)
  }

  loadMore(): void {
    const current = this.snapshot.current
    if (current.nextCursor === undefined || current.status === 'loading' || this.snapshot.viewState === 'blocked') return
    void this.loadQueue(this.snapshot.queue, this.snapshot.expiredOnly, current.nextCursor)
  }

  async openBody(name: string, side: 'live' | 'archive'): Promise<void> {
    const token = ++this.overlayToken
    this.set({ ...this.snapshot, overlay: { kind: 'body', name, side, status: 'loading' } })
    const outcome = await this.source.body(name, side)
    if (this.disposed || token !== this.overlayToken) return
    if (!outcome.ok) {
      if (outcome.failure.kind === 'blocked') {
        this.set({ ...this.snapshot, viewState: 'blocked', viewFailure: outcome.failure, overlay: undefined })
        return
      }
      this.set({ ...this.snapshot, overlay: { kind: 'body', name, side, status: 'error', failure: outcome.failure } })
      return
    }
    this.set({ ...this.snapshot, overlay: { kind: 'body', name, side, status: 'ready', body: outcome.payload } })
  }

  async openHistory(): Promise<void> {
    const token = ++this.overlayToken
    this.set({ ...this.snapshot, overlay: { kind: 'history', status: 'loading' } })
    const outcome = await this.source.history()
    if (this.disposed || token !== this.overlayToken) return
    if (!outcome.ok) {
      if (outcome.failure.kind === 'blocked') {
        this.set({ ...this.snapshot, viewState: 'blocked', viewFailure: outcome.failure, overlay: undefined })
        return
      }
      this.set({ ...this.snapshot, overlay: { kind: 'history', status: 'error', failure: outcome.failure } })
      return
    }
    this.set({ ...this.snapshot, overlay: { kind: 'history', status: 'ready', items: outcome.payload.items } })
  }

  closeOverlay(): void {
    this.overlayToken += 1
    this.set({ ...this.snapshot, overlay: undefined })
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }
}
