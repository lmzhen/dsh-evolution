/** Per-view projection state; one instance per (workspace, scope, revision). */
export type ProjectionPhase = 'off' | 'unavailable' | 'bootstrapping' | 'ready' | 'degraded'
export type MapState = 'empty' | 'ready' | 'stale' | 'corrupt'
export type SearchState = 'ready' | 'degraded'
export type PolicyState = 'ready' | 'degraded'

/** Observable state for one view; never a global readiness flag. */
export interface ViewState {
  readonly viewKey: string
  readonly phase: ProjectionPhase
  readonly map: MapState
  readonly search: SearchState
  readonly policy: PolicyState
  readonly reasons: readonly string[]
  readonly mapVersion: string
  readonly policyDigest: string
  readonly viewCatalogDigest: string
}

/** Inputs used to derive one view state. */
export interface ViewStateInput {
  readonly viewKey: string
  readonly mode: 'off' | 'on'
  readonly map: MapState
  readonly search: SearchState
  readonly policy: PolicyState
  readonly catalogComplete: boolean
  readonly mapVersion: string
  readonly policyDigest: string
  readonly viewCatalogDigest: string
  readonly reasons?: readonly string[]
}

/**
 * Derive one view's state without consulting another view.
 * @param input - per-view health and identity.
 * @returns state with reasons; card rendering is gated by canProject.
 */
export function deriveViewState(input: ViewStateInput): ViewState {
  const reasons = [...(input.reasons ?? [])]
  if (input.mode === 'off') return { ...input, phase: 'off', reasons }
  if (!input.catalogComplete) reasons.push('catalog-incomplete')
  if (input.map === 'empty' || input.map === 'corrupt') {
    reasons.push(input.map === 'corrupt' ? 'map-corrupt' : 'map-empty')
    return { ...input, phase: 'unavailable', reasons }
  }
  if (input.map === 'stale') reasons.push('map-stale')
  if (input.search === 'degraded') reasons.push('search-degraded')
  if (input.policy === 'degraded') reasons.push('policy-degraded')
  if (!input.catalogComplete || input.search === 'degraded' || input.policy === 'degraded') {
    return { ...input, phase: 'degraded', reasons }
  }
  return { ...input, phase: 'ready', reasons }
}

/** @returns true when this view may render cards, even if hiding is blocked. */
export function canProject(state: ViewState): boolean {
  return (state.phase === 'ready' || state.phase === 'degraded') && (state.map === 'ready' || state.map === 'stale')
}

interface RegistryEntry { readonly state: ViewState; readonly at: number }

/** Bounded view-state cache keyed by view identity and codec version. */
export class ViewStateRegistry {
  private readonly entries = new Map<string, RegistryEntry>()
  private readonly limit: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: { readonly limit?: number | undefined; readonly ttlMs?: number | undefined; readonly now?: (() => number) | undefined } = {}) {
    this.limit = options.limit ?? 64
    this.ttlMs = options.ttlMs ?? 10 * 60_000
    this.now = options.now ?? Date.now
  }

  /** @returns cache key including all identity components that can change a view. */
  key(state: Pick<ViewState, 'viewKey' | 'mapVersion' | 'policyDigest'>, codecVersion: string): string {
    return state.viewKey + '|' + state.mapVersion + '|' + state.policyDigest + '|' + codecVersion
  }

  set(state: ViewState, codecVersion: string): void {
    const key = this.key(state, codecVersion)
    this.entries.delete(key)
    this.entries.set(key, { state, at: this.now() })
    this.prune()
  }

  get(viewKey: string, mapVersion: string, policyDigest: string, codecVersion: string): ViewState | undefined {
    const key = viewKey + '|' + mapVersion + '|' + policyDigest + '|' + codecVersion
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (this.now() - entry.at > this.ttlMs) {
      this.entries.delete(key)
      return undefined
    }
    return entry.state
  }

  deleteView(viewKey: string): void {
    for (const [key, entry] of this.entries) if (entry.state.viewKey === viewKey) this.entries.delete(key)
  }

  prune(): void {
    const now = this.now()
    for (const [key, entry] of this.entries) if (now - entry.at > this.ttlMs) this.entries.delete(key)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}
