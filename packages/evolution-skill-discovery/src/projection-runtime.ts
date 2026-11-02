import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { DomainMapSnapshot, DomainMapStore } from './domain-map.ts'
import { buildDomainProjection } from './domain-projection.ts'
import type { DomainPolicyStore } from './domain-policy-store.ts'
import { SkillIndex, type SkillIndexSource } from './skill-index.ts'
import { applyProjectedDecision, applyReplacementDecision, applyRestoreUpdate, captureDecisionCatalog, restoreCapturedProjection } from './projection-adapter.ts'
import { captureCatalog, renderCatalog, type CatalogCapture } from './catalog-codec.ts'
import { ProjectionJournal } from './projection-journal.ts'
import { canProject, deriveViewState, type MapState, type SearchState, type ViewState, ViewStateRegistry } from './view-state.ts'

/** Working-directory port; supplied by the platform composition. */
export interface WorkingDirectoryPort {
  ensure(agent: Agent, signal?: AbortSignal | undefined): Promise<string>
}

/** Bounded catalog/projection history from the evolution-core projection unit. */
export interface ProjectionHistoryView {
  readonly catalogs: readonly { readonly text: string; readonly entries: readonly { readonly name: string; readonly description: string }[]; readonly update: boolean }[]
  readonly digests: readonly string[]
}

/** Inputs for the per-view projection runtime. */
export interface ProjectionRuntimePorts {
  readonly skillIndexSource: SkillIndexSource
  readonly map: DomainMapStore
  readonly policy: DomainPolicyStore
  readonly policyFor?: ((cwd: string) => Promise<DomainPolicyStore>) | undefined
  readonly journal: ProjectionJournal
  readonly workingDirectory: WorkingDirectoryPort
  readonly history?: ((agent: Agent) => ProjectionHistoryView | undefined) | undefined
  /** Degraded-path warning sink; absence is silent for tests that do not care. */
  readonly warn?: ((message: string) => void) | undefined
  readonly featureEpoch: string
  readonly codecVersion: string
  readonly adapterVersion: string
  readonly projectionSchemaVersion: string
  readonly mode: 'off' | 'on'
  readonly maxCards?: number | undefined
  readonly tokenBudget?: number | undefined
  readonly searchAvailable?: (() => boolean) | undefined
  readonly staleAfterHours?: number | undefined
  readonly descriptionStaleAfterHours?: number | undefined
  readonly isFrozen?: ((agent: Agent) => boolean | Promise<boolean>) | undefined
}

function mapStateOf(snapshot: DomainMapSnapshot | undefined, staleAfterHours: number | undefined, now: number): MapState {
  if (snapshot === undefined) return 'corrupt'
  if (snapshot.domains.length === 0) return 'empty'
  if (staleAfterHours !== undefined && snapshot.domains.some(node => now - node.updatedAt > staleAfterHours * 3_600_000)) return 'stale'
  return 'ready'
}

/** Last projection action, for diagnostics and current-request assertions. */
export interface ProjectionReport {
  readonly action: 'none' | 'applied' | 'restored' | 'blocked'
  readonly digest: string
  readonly content?: string | undefined
  readonly at: number
}

function effectiveMode(mode: 'off' | 'on'): 'off' | 'on' {
  return mode
}

function catalogText(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('')
}

function fullCatalogText(capture: CatalogCapture): string {
  return catalogText(renderCatalog(capture, capture.entries))
}

function captureOfFrame(frame: ProjectionHistoryView['catalogs'][number]): CatalogCapture {
  return { text: frame.text, source: { kind: 'skill-catalog', form: 'catalog', ...(frame.update ? { update: true as const } : {}), entries: frame.entries }, entries: frame.entries, update: frame.update }
}

function sessionCatalogCapture(agent: Agent, history?: ProjectionHistoryView | undefined): CatalogCapture | undefined {
  if (history !== undefined && history.catalogs.length > 0) {
    let full: CatalogCapture | undefined
    let projected: CatalogCapture | undefined
    for (const frame of history.catalogs) {
      const capture = captureOfFrame(frame)
      projected = capture
      if (catalogText({ content: [{ type: 'text', text: frame.text }] }) === fullCatalogText(capture)) full = capture
    }
    return full ?? projected
  }
  const readEvents = (agent.session as { readEvents?: () => Iterable<{ type: string; data?: unknown }> }).readEvents
  if (readEvents === undefined) return undefined
  let full: CatalogCapture | undefined
  let projected: CatalogCapture | undefined
  for (const event of readEvents()) {
    if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) continue
    const message = event.data as UserMessage
    if (message.source.kind !== 'skill-catalog') continue
    const capture = captureCatalog(message)
    if (capture === undefined) continue
    projected = capture
    if (catalogText(message) === fullCatalogText(capture)) full = capture
  }
  return full ?? projected
}

/** The full platform catalog carried by a (possibly projected) capture. */
function fullCaptureOf(capture: CatalogCapture): CatalogCapture | undefined {
  return captureCatalog(renderCatalog(capture, capture.entries))
}

/** Digest of every projection context already present in session history. */
function sessionProjectionDigests(agent: Agent, history?: ProjectionHistoryView | undefined): ReadonlySet<string> {
  const digests = new Set<string>(history?.digests ?? [])
  const readEvents = (agent.session as { readEvents?: () => Iterable<{ type: string; data?: unknown }> }).readEvents
  if (readEvents === undefined) return digests
  for (const event of readEvents()) {
    if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) continue
    const message = event.data as UserMessage
    if (message.source.kind !== 'evolution-skill-projection') continue
    const digest = (message.source as { digest?: unknown }).digest
    if (typeof digest === 'string') digests.add(digest)
  }
  return digests
}

/** Per-view projection runtime; no global readiness and no history edits. */
export class ProjectionRuntime {
  private readonly ports: ProjectionRuntimePorts
  private readonly states = new ViewStateRegistry()
  private last: ProjectionReport = { action: 'none', digest: '', at: 0 }
  private readonly lastByAgent = new Map<string, ProjectionReport>()
  private warnedMissingHistory = false

  constructor(ports: ProjectionRuntimePorts) { this.ports = ports }

  /** @returns last action for one agent, or the latest process-wide action. */
  report(agent?: Agent | undefined): ProjectionReport { return agent === undefined ? this.last : this.lastByAgent.get(String(agent.id)) ?? this.last }

  private hasStructuralLog(agent: Agent): boolean {
    return typeof (agent.session as { readEvents?: unknown }).readEvents === 'function'
  }

  private warnMissingHistory(): void {
    if (this.warnedMissingHistory) return
    this.warnedMissingHistory = true
    this.ports.warn?.('evolution-skill-discovery: no sessionProjections history and no structural readEvents for this session — catalog restore/dedupe is unavailable; failing open (mount the projection registry to keep replacement dedupe)')
  }

  private mark(agent: Agent, action: ProjectionReport['action'], digest: string, content = ''): void {
    const report = { action, digest, content, at: Date.now() }
    this.last = report
    this.lastByAgent.set(String(agent.id), report)
  }

  /** @returns current state for diagnostics, if this process has seen the view. */
  stateFor(viewKey: string, mapVersion: string, policyDigest: string): ViewState | undefined {
    return this.states.get(viewKey, mapVersion, policyDigest, this.ports.codecVersion)
  }

  private async restore(agent: Agent, viewKey: string, decision: PreStepDecision, currentCapture?: CatalogCapture): Promise<PreStepDecision> {
    const record = await this.ports.journal.latest(String(agent.id), viewKey, this.ports.codecVersion)
    const history = this.ports.history?.(agent)
    const sessionBase = sessionCatalogCapture(agent, history)
    const fullSession = sessionBase === undefined ? undefined : (sessionBase.text === fullCatalogText(sessionBase) ? sessionBase : fullCaptureOf(sessionBase))
    const projectedCurrent = currentCapture !== undefined && currentCapture.text !== fullCatalogText(currentCapture)
    const fullCurrent = currentCapture === undefined ? undefined : fullCaptureOf(currentCapture)
    // A journal record is the base used by the newest projection; prefer it over an
    // older full catalog still present in session history.
    const durable = projectedCurrent
      ? record?.base ?? fullSession ?? fullCurrent
      : fullCurrent ?? fullSession ?? record?.base
    if (durable === undefined) {
      if (history === undefined && !this.hasStructuralLog(agent)) { this.warnMissingHistory(); return decision }
      this.mark(agent, 'blocked', '')
      return decision
    }
    const fullText = fullCatalogText(durable)
    const previous = this.report(agent)
    if (previous.action === 'restored' && previous.content === fullText) return decision
    const restored = currentCapture === undefined
      ? applyRestoreUpdate(decision, durable)
      : restoreCapturedProjection(decision, durable)
    // Old records for the same view must not resurrect after a restart.
    await this.ports.journal.removeView(String(agent.id), viewKey, this.ports.codecVersion)
    this.mark(agent, 'restored', record?.projectionDigest ?? '', fullText)
    return restored
  }

  private async readState(agent: Agent, signal?: AbortSignal | undefined): Promise<{ readonly view: Awaited<ReturnType<SkillIndex['read']>>; readonly snapshot: DomainMapSnapshot | undefined; readonly policy: ReturnType<DomainPolicyStore['resolve']>; readonly policyDigest: string; readonly state: ViewState }> {
    const cwd = await this.ports.workingDirectory.ensure(agent, signal)
    const view = await new SkillIndex(this.ports.skillIndexSource).read({ cwd, scopeKey: String(agent.id), scope: agent, signal })
    let snapshot: DomainMapSnapshot | undefined
    try {
      snapshot = await this.ports.map.read()
    } catch {
      snapshot = undefined
    }
    const knownDomainIds = snapshot === undefined ? undefined : new Set(snapshot.domains.map(node => node.id))
    const store = this.ports.policyFor === undefined ? this.ports.policy : await this.ports.policyFor(cwd)
    const policy = store.resolve(knownDomainIds)
    const policyDigest = store.digest(knownDomainIds)
    const search: SearchState = this.ports.searchAvailable?.() === false ? 'degraded' : 'ready'
    const state = deriveViewState({
      viewKey: view.viewKey, mode: effectiveMode(policy.mode), map: mapStateOf(snapshot, this.ports.staleAfterHours, Date.now()), search, policy: policy.degraded.length === 0 ? 'ready' : 'degraded',
      catalogComplete: view.complete, mapVersion: snapshot?.mapVersion ?? '0',
      policyDigest, viewCatalogDigest: view.viewCatalogDigest,
    })
    this.states.set(state, this.ports.codecVersion)
    return { view, snapshot, policy, policyDigest, state }
  }

  /** @returns current per-view state without projecting; used by diagnostic commands. */
  async inspect(agent: Agent, signal?: AbortSignal | undefined): Promise<ViewState> {
    if (this.ports.mode === 'off') return { viewKey: 'off', phase: 'off', map: 'empty', search: 'ready', policy: 'ready', reasons: [], mapVersion: '0', policyDigest: '', viewCatalogDigest: '' }
    return (await this.readState(agent, signal)).state
  }

  /**
   * Project or restore one current pre-step decision.
   * @param agent - session owner; identity comes from workingDirectory.
   * @param decision - current waterfall decision.
   * @param signal - request cancellation.
   * @returns projected, restored, or unchanged decision.
   */
  async project(agent: Agent, decision: PreStepDecision, signal?: AbortSignal | undefined): Promise<PreStepDecision> {
    if (this.ports.mode === 'off') return decision
    if (this.ports.isFrozen !== undefined && await this.ports.isFrozen(agent)) return decision
    const { view, snapshot, policy, policyDigest, state } = await this.readState(agent, signal)
    const currentCapture = captureDecisionCatalog(decision)
    const history = this.ports.history?.(agent)
    if (history === undefined && !this.hasStructuralLog(agent)) this.warnMissingHistory()
    const seen = new Set(sessionProjectionDigests(agent, history))
    if (decision.kind === 'enter') {
      for (const message of decision.messages) {
        if (message.source.kind !== 'evolution-skill-projection') continue
        const digest = (message.source as { digest?: unknown }).digest
        if (typeof digest === 'string') seen.add(digest)
      }
    }
    const previous = this.report(agent)
    if (previous.action === 'applied' && previous.digest !== '') seen.add(previous.digest)
    let capture = currentCapture
    if (capture === undefined) capture = (await this.ports.journal.latest(String(agent.id), view.viewKey, this.ports.codecVersion))?.base
    if (capture === undefined) capture = sessionCatalogCapture(agent, history)
    if (!canProject(state) || snapshot === undefined) return this.restore(agent, view.viewKey, decision, currentCapture)
    if (capture === undefined) {
      if (history === undefined && !this.hasStructuralLog(agent)) return decision
      this.mark(agent, 'blocked', '')
      return decision
    }
    const projection = buildDomainProjection({
      entries: capture.entries, rows: view.rows, complete: view.complete, snapshot, policy,
      viewKey: view.viewKey, scope: String(agent.id), mapVersion: snapshot.mapVersion,
      policyDigest, viewCatalogDigest: view.viewCatalogDigest, adapterVersion: this.ports.adapterVersion,
      projectionSchemaVersion: this.ports.projectionSchemaVersion, discoveryMode: this.ports.mode,
      ...this.ports.maxCards === undefined ? {} : { maxCards: this.ports.maxCards },
      ...this.ports.tokenBudget === undefined ? {} : { tokenBudget: this.ports.tokenBudget },
      searchAvailable: state.search === 'ready', mode: effectiveMode(policy.mode), mapStale: state.map === 'stale', now: Date.now(),
      ...this.ports.staleAfterHours === undefined ? {} : { staleAfterHours: this.ports.staleAfterHours },
      ...this.ports.descriptionStaleAfterHours === undefined ? {} : { descriptionStaleAfterHours: this.ports.descriptionStaleAfterHours },
    })
    if (!projection.complete) return this.restore(agent, view.viewKey, decision, currentCapture)
    const expected = renderCatalog(capture, projection.catalogEntries)
    const expectedText = expected.content.map(block => block.type === 'text' ? block.text : '').join('')
    if (currentCapture !== undefined && currentCapture.text === expectedText) {
      return seen.has(projection.digest) ? decision : applyProjectedDecision(decision, currentCapture, projection, seen)
    }
    if (currentCapture === undefined && seen.has(projection.digest)) return decision
    if (currentCapture === undefined && previous.action === 'applied' && previous.digest === projection.digest && previous.content === expectedText) return decision
    await this.ports.journal.put({
      sessionId: String(agent.id), viewKey: view.viewKey, projectionDigest: projection.digest,
      codecVersion: this.ports.codecVersion, mapVersion: snapshot.mapVersion, policyDigest,
      base: capture, createdAt: Date.now(),
    })
    this.mark(agent, 'applied', projection.digest, expectedText)
    return currentCapture === undefined ? applyReplacementDecision(decision, capture.source.entries, projection, seen) : applyProjectedDecision(decision, capture, projection, seen)
  }
}
