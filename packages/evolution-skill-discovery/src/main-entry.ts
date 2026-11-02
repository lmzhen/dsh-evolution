import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { Context as HostContext } from '@deepseek-ai/cordis/src/context.ts'

type Context = CordisContext & HostContext
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

// platform-declaration anchor: this composition probes skills/workingDirectory/tools/evolutionIo/systemPrompt; all are declared in core PLATFORM_SERVICE_PROBES.
import { authorityFrom, evolutionIoAdapter, evolutionRoot, newSkillLibrary, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { LlmStreamService } from './domain-generation-llm.ts'
import { DomainGenerationCoordinator } from './domain-generation-coordinator.ts'
import { DomainPolicyStore } from './domain-policy-store.ts'
import type { DomainPolicyLayer } from './domain-policy.ts'
import { DomainMapFileStore } from './domain-map-store.ts'
import type { DomainMapSnapshot } from './domain-map.ts'
import { ProjectionJournal } from './projection-journal.ts'
import { ProjectionRuntime } from './projection-runtime.ts'
import { SkillIndex, type SkillIndexQuery, type SkillIndexSource, type SkillIndexSourceSnapshot } from './skill-index.ts'
import { SkillSearchCache } from './search.ts'
import { registerSkillSearchTool } from './tool.ts'
import { buildGenerationRequest, resolveGenerationPort } from './generation-composition.ts'
import { DOMAIN_GENERATION_PROMPT_VERSION, buildDomainGenerationPrompt } from './domain-generation-prompt.ts'
import { ViewSnapshotStore } from './view-snapshot-store.ts'
import { skillKeyOf } from './identity.ts'
import { DomainAssignmentService } from './assignment.ts'
import { JsonAssignmentQueue } from './assignment-queue.ts'
import { AssignmentWorker } from './worker.ts'
import { installAssignmentSidecar } from './assignment-sidecar.ts'
import { installDiscoveryAwareness } from './awareness.ts'
import { markStaleDescriptions, refreshStaleDescriptions } from './description-refresh.ts'

/** Main production config. */
export interface Config {
  readonly featureEpoch: string
  readonly mode?: 'off' | 'shadow' | 'on' | undefined
  readonly searchEnabled?: boolean | undefined
  readonly domainMapPath?: string | undefined
  readonly projectionJournalPath?: string | undefined
  readonly viewSnapshotPath?: string | undefined
  readonly assignmentQueuePath?: string | undefined
  readonly createClassificationEnabled?: boolean | undefined
  readonly provisionalThreshold?: number | undefined
  readonly mapReferenceCwd?: string | undefined
  readonly mapReferenceScope?: string | undefined
  readonly generationProvider?: string | undefined
  readonly generationModel?: string | undefined
  readonly generationTimeoutMs?: number | undefined
  readonly generationMaxTokens?: number | undefined
  readonly generationAttempts?: number | undefined
  readonly maxCards?: number | undefined
  readonly tokenBudget?: number | undefined
  readonly pinDomains?: readonly string[] | undefined
  readonly disableDomains?: readonly string[] | undefined
  readonly staleAfterHours?: number | undefined
  readonly descriptionStaleAfterHours?: number | undefined
  readonly workspacePolicy?: DomainPolicyLayer | undefined
  readonly scopePolicy?: DomainPolicyLayer | undefined
  readonly workspacePolicyPath?: string | undefined
  readonly scopePolicyPath?: string | undefined
}

export const name = 'evolution-skill-discovery'
export const inject = ['skills', 'workingDirectory', 'tools', 'evolutionIo', 'systemPrompt']

class PlatformSource implements SkillIndexSource {
  private readonly ctx: Context
  private readonly library: SkillLibrary
  constructor(ctx: Context, library: SkillLibrary) { this.ctx = ctx; this.library = library }
  async snapshot(query: SkillIndexQuery): Promise<SkillIndexSourceSnapshot> {
    const snapshot = await this.ctx.skills.snapshot({ cwd: query.cwd, ...query.scope === undefined ? {} : { scope: query.scope } })
    return { skills: snapshot.skills, complete: snapshot.complete }
  }
  async managedSkillKeys(): Promise<ReadonlySet<string>> {
    return new Set((await this.library.list()).filter(summary => summary.managed).map(summary => skillKeyOf({ provider: 'dsh-evolution', source: 'user-dsh', name: summary.name })))
  }
  async protectedSkillKeys(): Promise<ReadonlySet<string>> {
    return new Set((await this.library.list()).filter(summary => summary.protectedBy !== null || summary.protectionUnknown).map(summary => skillKeyOf({ provider: 'dsh-evolution', source: 'user-dsh', name: summary.name })))
  }
  async pinnedSkillKeys(): Promise<ReadonlySet<string>> {
    return new Set((await this.library.list()).filter(summary => summary.protectedBy === 'pinned').map(summary => skillKeyOf({ provider: 'dsh-evolution', source: 'user-dsh', name: summary.name })))
  }
}

interface WorkingDirectoryService {
  ensure(agent: Agent, signal?: AbortSignal | undefined): Promise<string>
}

function searchUnavailable() {
  return { results: [], truncated: false, degraded: true, hint: 'Skill search is unavailable without a session working directory.' }
}

/** Apply the full production discovery composition. */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.featureEpoch !== 'string' || config.featureEpoch.length === 0) throw new Error('evolution-skill-discovery: featureEpoch is required')
  const evolutionIo = (ctx as Context & { evolutionIo: { provider(): EvolutionIoLike } }).evolutionIo
  const io = evolutionIoAdapter(() => evolutionIo.provider())
  const library = newSkillLibrary({ config: {}, io, ctx, authority: authorityFrom({ origin: 'foreground' }) })
  const source = new PlatformSource(ctx, library)
  const index = new SkillIndex(source)
  const workingDirectory = ctx.get('workingDirectory') as WorkingDirectoryService | undefined
  if (workingDirectory === undefined) throw new Error('evolution-skill-discovery: workingDirectory service is required')
  const root = evolutionRoot()
  let mode: 'off' | 'shadow' | 'on' = config.mode ?? 'off'
  let generation = undefined as ReturnType<typeof resolveGenerationPort>
  if (mode !== 'off') {
    generation = resolveGenerationPort({
      mode,
      ...ctx.get('llm') === undefined ? {} : { llm: ctx.get('llm') as LlmStreamService },
      provider: config.generationProvider ?? 'deepseek-official',
      model: config.generationModel ?? 'deepseek-flash',
      ...config.generationTimeoutMs === undefined ? {} : { timeoutMs: config.generationTimeoutMs },
      ...config.generationMaxTokens === undefined ? {} : { maxTokens: config.generationMaxTokens },
      ...config.generationAttempts === undefined ? {} : { attempts: config.generationAttempts },
    })
  }
  const searchCache = new SkillSearchCache()
  // Fail open until the index proves it can serve: a session that never searches must not hide skills.
  let searchHealthy = false
  const search = {
    async allowedSkillKeys(agent?: Agent | undefined, signal?: AbortSignal | undefined): Promise<ReadonlySet<string> | undefined> {
      if (mode === 'off' || agent === undefined) return undefined
      const cwd = await workingDirectory.ensure(agent, signal)
      const view = await index.read({ cwd, scopeKey: String(agent.id), scope: agent, signal })
      let snapshot: DomainMapSnapshot | undefined
      try { snapshot = await map.read() } catch { return undefined }
      const known = new Set(snapshot.domains.map(node => node.id))
      const effective = (await policyFor(cwd)).resolve(known)
      const blocked = new Set(snapshot.edges.filter(edge => edge.status === 'active' && effective.disabled.has(edge.domainId)).map(edge => edge.skillKey))
      return new Set(view.rows.filter(row => row.modelInvocable && !blocked.has(row.skillKey)).map(row => row.skillKey))
    },
    async search(query: { query: string; limit?: number | undefined }, options?: { readonly allowedSkillKeys?: ReadonlySet<string> | undefined }, agent?: Agent | undefined, signal?: AbortSignal | undefined) {
      if (agent === undefined) return searchUnavailable()
      const cwd = await workingDirectory.ensure(agent, signal)
      const view = await index.read({ cwd, scopeKey: String(agent.id), scope: agent, signal })
      const viewPolicy = mode === 'off' ? undefined : await policyFor(cwd)
      const cached = await searchCache.get({ viewKey: view.viewKey, viewCatalogDigest: view.viewCatalogDigest, policyDigest: viewPolicy?.digest() ?? 'off', discoveryMode: mode }, view.rows)
      if (cached === undefined) { searchHealthy = false; return { results: [], truncated: false, degraded: true, hint: 'Skill search index is unavailable. Use the full catalog or skill(name).' } }
      searchHealthy = true
      const result = await cached.index.search(query, options)
      return result.stale || cached.stale ? { ...result, stale: true } : result
    },
  }
  if (config.searchEnabled !== false) ctx.effect(() => registerSkillSearchTool(ctx, search))
  ctx.on('evolution/skill-mutated', () => { searchCache.clear() })
  if (mode === 'off') return

  const map = new DomainMapFileStore(io, config.domainMapPath ?? join(root, 'evolution', 'domain-map.json'))
  const descriptionStaleAfterHours = config.descriptionStaleAfterHours ?? 24 * 7
  const journal = new ProjectionJournal(io, config.projectionJournalPath ?? join(root, 'evolution', 'projection-journal.json'))
  const snapshots = new ViewSnapshotStore(io, config.viewSnapshotPath ?? join(root, 'evolution', 'view-snapshots.json'))
  const globalPolicy: DomainPolicyLayer = { mode: mode === 'shadow' ? 'auto' : mode, pinDomains: config.pinDomains, disableDomains: config.disableDomains }
  const policy = new DomainPolicyStore({ global: globalPolicy, ...config.workspacePolicy === undefined ? {} : { workspace: config.workspacePolicy }, ...config.scopePolicy === undefined ? {} : { scope: config.scopePolicy } })
  const readLayer = async (cwd: string, path: string | undefined): Promise<DomainPolicyLayer | undefined> => {
    if (path === undefined) return undefined
    try {
      const text = await io.readText(isAbsolute(path) ? path : resolve(cwd, path))
      return text === null ? undefined : JSON.parse(text) as DomainPolicyLayer
    } catch (error) {
      ctx.logger.warn('evolution-skill-discovery: policy layer unreadable: ' + (error instanceof Error ? error.message : String(error)))
      return undefined
    }
  }
  const policyFor = async (cwd: string): Promise<DomainPolicyStore> => {
    const workspace = await readLayer(cwd, config.workspacePolicyPath) ?? config.workspacePolicy
    const scope = await readLayer(cwd, config.scopePolicyPath) ?? config.scopePolicy
    return new DomainPolicyStore({ global: globalPolicy, ...workspace === undefined ? {} : { workspace }, ...scope === undefined ? {} : { scope } })
  }
  const runtime = new ProjectionRuntime({
    skillIndexSource: source, map, policy, policyFor, journal, workingDirectory,
    featureEpoch: config.featureEpoch, codecVersion: '1', adapterVersion: '1', projectionSchemaVersion: '1', mode,
    ...config.maxCards === undefined ? {} : { maxCards: config.maxCards },
    ...config.tokenBudget === undefined ? {} : { tokenBudget: config.tokenBudget },
    searchAvailable: () => searchHealthy && config.searchEnabled !== false,
    ...config.staleAfterHours === undefined ? {} : { staleAfterHours: config.staleAfterHours },
    descriptionStaleAfterHours,
    isFrozen: async agent => snapshots.isFrozen(String(agent.session.id), config.featureEpoch),
  })
  const queue = new JsonAssignmentQueue(io, config.assignmentQueuePath ?? join(root, 'evolution', 'assignment-queue.json'), ctx.get('evolutionStateStore'))
  const assignment = new DomainAssignmentService(queue, map, { createClassificationEnabled: config.createClassificationEnabled ?? false, ...config.provisionalThreshold === undefined ? {} : { provisionalThreshold: config.provisionalThreshold }, now: Date.now })
  const worker = new AssignmentWorker(assignment, queue)
  void queue.load().then(() => worker.drain()).catch(() => { ctx.logger.warn('evolution-skill-discovery: assignment queue load failed; queued work stays for the next start') })
  installAssignmentSidecar(ctx, assignment, { onSubmitted: () => { void worker.drain().catch(error => { ctx.logger.warn('evolution-skill-discovery: assignment drain failed: ' + (error instanceof Error ? error.message : String(error))) }) } })
  ctx.on('agent/created', async ({ agent, source: start }) => {
    try { installDiscoveryAwareness(agent.ctx as Context) } catch (error) { ctx.logger.warn('evolution-skill-discovery: awareness install failed: ' + (error instanceof Error ? error.message : String(error))) }
    if (start !== 'startup') return
    try {
      const cwd = await workingDirectory.ensure(agent)
      const view = await index.read({ cwd, scopeKey: String(agent.id), scope: agent })
      await snapshots.put({ sessionId: String(agent.session.id), viewKey: view.viewKey, cwd, viewCatalogDigest: view.viewCatalogDigest, mapVersion: '0', configDigest: 'production', featureEpoch: config.featureEpoch, createdAt: Date.now() })
      const marked = await markStaleDescriptions(map, descriptionStaleAfterHours)
      if (marked > 0) ctx.logger.info('evolution-skill-discovery: marked ' + marked + ' aged domain descriptions stale')
      const refreshed = await refreshStaleDescriptions(map)
      if (refreshed > 0) ctx.logger.info('evolution-skill-discovery: refreshed ' + refreshed + ' stale domain descriptions')
    } catch (error) {
      ctx.logger.warn('evolution-skill-discovery: initial view snapshot failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  })
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    try { return await runtime.project(agent, decision, signal) } catch (error) {
      ctx.logger.warn('evolution-skill-discovery: projection failed open: ' + (error instanceof Error ? error.message : String(error)))
      return decision
    }
  }, { prepend: true })
  const coordinator = generation === undefined ? undefined : new DomainGenerationCoordinator(map, generation)
  const commandRuntime = ctx.get('commands') as { register: (definition: { name: string; description: string; handler: (invocation: { rawInput: string; agent: Agent }) => Promise<{ kind: 'success'; text?: string } | { kind: 'error'; text: string }> }) => () => void } | undefined
  if (commandRuntime !== undefined) {
    ctx.effect(() => commandRuntime.register({
      name: 'skill-domain',
      description: 'Generate or inspect the skill domain map.',
      async handler({ rawInput, agent }) {
        const [action] = rawInput.trim().split(/\s+/)
        if (action === 'status') {
          const statusCwd = await workingDirectory.ensure(agent)
          const view = await index.read({ cwd: statusCwd, scopeKey: String(agent.id), scope: agent })
          const rows = view.rows.slice(0, 12).map(row => row.name + ' | provider=' + row.provider + ' source=' + row.source + ' managed=' + String(row.managed) + ' invocable=' + String(row.modelInvocable) + ' protected=' + String(row.protected) + ' pinned=' + String(row.pinned) + ' key=' + row.skillKey + ' hash=' + row.threeFieldHash)
          const state = await runtime.inspect(agent)
          const report = runtime.report(agent)
          return { kind: 'success' as const, text: 'discovery mode=' + mode + '; view=' + view.viewKey + '; phase=' + state.phase + ' map=' + state.map + ' search=' + state.search + ' policy=' + state.policy + ' last=' + report.action + (state.reasons.length === 0 ? '' : ' reasons=' + state.reasons.join(',')) + '\n' + rows.join('\n') }
        }
        if (action === 'confirm') {
          const domainId = rawInput.trim().split(/\s+/)[1]
          if (domainId === undefined) return { kind: 'error' as const, text: 'Usage: /skill-domain confirm <id>' }
          const confirmed = await assignment.confirm(domainId)
          return confirmed ? { kind: 'success' as const, text: 'Confirmed domain ' + domainId + '.' } : { kind: 'error' as const, text: 'Unknown or non-provisional domain: ' + domainId }
        }
        if (action !== 'generate') return { kind: 'error' as const, text: 'Usage: /skill-domain status | generate | confirm <id>' }
        if (coordinator === undefined) return { kind: 'error' as const, text: 'Generation is unavailable: no llm/generation port is mounted.' }
        if (config.mapReferenceCwd === undefined) return { kind: 'error' as const, text: 'No mapReferenceCwd configured; refusing to generate a global map from the caller view.' }
        const view = await index.read({ cwd: config.mapReferenceCwd, scopeKey: config.mapReferenceScope ?? String(agent.id), scope: agent })
        const request = buildGenerationRequest({ mapScope: 'global', sourceDigest: view.viewCatalogDigest, mapVersion: (await map.read()).mapVersion, rows: view.rows, prompt: buildDomainGenerationPrompt({ minDomains: 8, maxDomains: 8 }), promptVersion: DOMAIN_GENERATION_PROMPT_VERSION, model: config.generationModel ?? 'deepseek-flash', runId: randomUUID() })
        const result = await coordinator.ensure(request)
        return { kind: 'success' as const, text: 'Domain map generated: ' + result.domains.length + ' domains, mapVersion=' + result.mapVersion }
      },
    }))
  }
}
