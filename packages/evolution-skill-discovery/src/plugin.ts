import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { authorityFrom, evolutionIoAdapter, evolutionRoot, newSkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { installCatalogProjection } from './adapter.ts'
import { installDiscoveryAwareness } from './awareness.ts'
import { DomainAssignmentService } from './assignment.ts'
import { JsonAssignmentQueue } from './assignment-queue.ts'
import { AssignmentWorker } from './worker.ts'
import { installAssignmentSidecar } from './assignment-sidecar.ts'
import { DomainMapFileStore } from './domain-map-store.ts'
import { bootstrapDomainMap } from './domain-bootstrap.ts'
import type { DomainGenerationProposal, GenerationSkillFact } from './domain-generation.ts'
import { buildDomainGenerationPrompt } from './domain-generation-prompt.ts'
import { initialDomainMap, type DomainGenerationPort } from './domain-generation-service.ts'
import { canPromoteShadow } from './domain-projection.ts'
import { ShadowEvidenceStore } from './shadow-evidence.ts'
import { mergeDomainPolicy } from './domain-policy.ts'
import { policyDigestOf, skillKeyOf } from './identity.ts'
import { SkillIndex, type SkillIndexQuery, type SkillIndexSource, type SkillIndexSourceSnapshot } from './index.ts'
import { DiscoveryRuntime } from './runtime.ts'
import { SkillSearchCache } from './search.ts'
import { DiscoverySessionStore } from './session-store.ts'
import { shouldInstallAwarenessOnResume } from './session-projection.ts'
import { registerSkillSearchTool } from './tool.ts'

/** Plugin config; paths are supplied by the composition, never guessed. */
export interface Config {
  readonly domainMapPath?: string | undefined
  readonly sessionPath?: string | undefined
  readonly featureEpoch: string
  readonly mode?: 'off' | 'shadow' | 'on' | 'auto'
  readonly pinDomains?: readonly string[]
  readonly disableDomains?: readonly string[]
  readonly tokenBudget?: number
  readonly staleAfterHours?: number
  readonly mapStale?: boolean
  readonly searchAvailable?: boolean
  readonly shadowEvidencePath?: string | undefined
  readonly domainMinDomains?: number
  readonly domainMaxDomains?: number
  readonly provisionalThreshold?: number
  readonly shadowEvidence?: { readonly samples: number; readonly hiddenRecoverableRate: number; readonly silentMisses: number }
  readonly maxCards?: number
  readonly createClassificationEnabled?: boolean
  readonly bootstrapDomains?: DomainGenerationProposal
  readonly bootstrapSkillKeys?: Readonly<Record<string, string>>
  readonly domainGeneration?: DomainGenerationPort
  readonly domainGenerationSkills?: readonly GenerationSkillFact[]
  readonly domainGenerationSkillKeys?: Readonly<Record<string, string>>
}

export const name = 'evolution-skill-discovery'
export const inject = ['skills', 'evolutionIo', 'systemPrompt', 'tools']

class PlatformSkillIndexSource implements SkillIndexSource {
  private readonly ctx: Context
  private readonly library: SkillLibrary
  constructor(ctx: Context, library: SkillLibrary) { this.ctx = ctx; this.library = library }
  async snapshot(query: SkillIndexQuery): Promise<SkillIndexSourceSnapshot> {
    const snapshot = await this.ctx.skills.snapshot({ cwd: query.cwd, ...query.scope === undefined ? {} : { scope: query.scope } })
    return { skills: snapshot.skills, complete: snapshot.complete }
  }
  async managedSkillKeys(): Promise<ReadonlySet<string>> {
    const summaries = await this.library.list()
    return new Set(summaries.filter(summary => summary.managed).map(summary => skillKeyOf({ provider: 'dsh-evolution', source: 'user-dsh', name: summary.name })))
  }
  async protectedSkillKeys(): Promise<ReadonlySet<string>> {
    const summaries = await this.library.list()
    return new Set(summaries.filter(summary => summary.protectedBy !== null || summary.protectionUnknown).map(summary => skillKeyOf({ provider: 'dsh-evolution', source: 'user-dsh', name: summary.name })))
  }
  async pinnedSkillKeys(): Promise<ReadonlySet<string>> {
    const summaries = await this.library.list()
    return new Set(summaries.filter(summary => summary.protectedBy === 'pinned').map(summary => skillKeyOf({ provider: 'dsh-evolution', source: 'user-dsh', name: summary.name })))
  }
}

/** Compose discovery services from platform ports; no catalog/provider replacement. */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.featureEpoch !== 'string' || config.featureEpoch.length === 0) throw new Error('evolution-skill-discovery: featureEpoch is required')
  if (config.provisionalThreshold !== undefined && (!Number.isSafeInteger(config.provisionalThreshold) || config.provisionalThreshold < 1)) throw new Error('evolution-skill-discovery: provisionalThreshold must be a positive integer')
  const evolutionIo = (ctx as Context & { evolutionIo: { provider(): EvolutionIoLike } }).evolutionIo
  const io = evolutionIoAdapter(() => evolutionIo.provider())
  const library = newSkillLibrary({ config: {}, io, ctx, authority: authorityFrom({ origin: 'foreground' }) })
  const source = new PlatformSkillIndexSource(ctx, library)
  const dshHome = evolutionRoot()
  const map = new DomainMapFileStore(io, config.domainMapPath ?? join(dshHome, 'evolution', 'domain-map.json'))
  if (config.domainGeneration !== undefined && config.domainGenerationSkills !== undefined && config.domainGenerationSkillKeys !== undefined) {
    void initialDomainMap(map, config.domainGeneration, config.domainGenerationSkills, config.domainGenerationSkillKeys, '0', undefined, buildDomainGenerationPrompt({ ...config.domainMinDomains === undefined ? {} : { minDomains: config.domainMinDomains }, ...config.domainMaxDomains === undefined ? {} : { maxDomains: config.domainMaxDomains } })).catch(() => { /* fail open; map may bootstrap later */ })
  }
  if (config.bootstrapDomains !== undefined && config.bootstrapSkillKeys !== undefined) {
    void bootstrapDomainMap(map, config.bootstrapDomains, config.bootstrapSkillKeys, '0').catch(() => { /* bootstrap failure keeps map empty; projection fails open */ })
  }
  const sessions = new DiscoverySessionStore(io, config.sessionPath ?? join(dshHome, 'evolution', 'discovery-sessions.json'))
  const policyMode: 'auto' | 'off' | 'on' = config.mode === 'shadow' || config.mode === undefined || config.mode === 'auto' ? 'auto' : config.mode
  const policy = mergeDomainPolicy({ mode: policyMode, pinDomains: config.pinDomains, disableDomains: config.disableDomains })
  const shadowStore = new ShadowEvidenceStore(io, config.shadowEvidencePath ?? join(dshHome, 'evolution', 'shadow-evidence.json'))
  let promoted = config.shadowEvidence !== undefined && canPromoteShadow(config.shadowEvidence)
  void shadowStore.load().then(() => { if (shadowStore.canPromote()) promoted = true }).catch(() => {})
  const policyDigest = policyDigestOf({ globalPolicyRevision: 'config', effectivePolicy: { mode: policy.mode, pinned: policy.pinned, disabled: policy.disabled } })
  const runtime = new DiscoveryRuntime({

    skillIndexSource: source,
    map,
    policy,
    sessionStore: sessions,
    featureEpoch: config.featureEpoch,
    mapVersion: '0',
    policyDigest,
    adapterVersion: '1',
    projectionSchemaVersion: '1',
    discoveryMode: config.mode === 'auto' ? 'shadow' : config.mode ?? 'off',
    maxCards: config.maxCards,
    tokenBudget: config.tokenBudget ?? 1200,
    staleAfterHours: config.staleAfterHours,
    mode: config.mode === 'auto' ? 'shadow' : config.mode === 'shadow' ? 'shadow' : config.mode === 'on' ? 'on' : 'off',
    autoMode: config.mode === 'auto',
    promoted: () => promoted,
    onProjection: (result) => { void shadowStore.record(result).then(() => { if (shadowStore.canPromote()) promoted = true }).catch(() => {}) },
    mapStale: config.mapStale ?? false,
    searchAvailable: config.searchAvailable ?? true,
  })
  ctx.on('agent/created', async ({ agent, source }) => {
    try {
      if (source === 'startup') {
        await sessions.put({ sessionId: String(agent.session.id), discoveryMode: config.mode === 'on' ? 'on' : config.mode === 'shadow' || config.mode === 'auto' ? 'shadow' : 'off', featureEpoch: config.featureEpoch })
        if (config.mode !== 'off') installDiscoveryAwareness(agent.ctx)
      } else {
        const meta = await sessions.get(String(agent.session.id))
        if (shouldInstallAwarenessOnResume(meta, config.featureEpoch)) installDiscoveryAwareness(agent.ctx)
      }
    } catch { /* discovery metadata must not block session creation */ }
  })
  const digestStore = {
    async get(agentKey: string) { return (await sessions.get(agentKey))?.projectionDigest },
    async set(agentKey: string, digest: string) {
      const record = await sessions.get(agentKey)
      if (record !== undefined) await sessions.put({ ...record, projectionDigest: digest })
    },
  }
  installCatalogProjection(ctx, runtime, digestStore)
  const queue = new JsonAssignmentQueue(io, join(dshHome, 'evolution', 'assignment-queue.json'))
  const assignment = new DomainAssignmentService(queue, map, { createClassificationEnabled: config.createClassificationEnabled ?? false, ...config.provisionalThreshold === undefined ? {} : { provisionalThreshold: config.provisionalThreshold }, now: Date.now })
  const worker = new AssignmentWorker(assignment, queue)
  void queue.load().then(() => worker.drain()).catch(() => { /* queued assignments stay for the next start */ })
  installAssignmentSidecar(ctx, assignment, { onSubmitted: () => { void worker.drain().catch(() => { /* assignment work is best-effort */ }) } })
  // platform-declaration anchor: commands is optional and declared in core PLATFORM_SERVICE_PROBES.
  const commandRuntime = ctx.get('commands') as { register: (definition: { name: string; description: string; handler: (invocation: { rawInput: string }) => { kind: 'success'; text?: string } | { kind: 'error'; text: string } | Promise<{ kind: 'success'; text?: string } | { kind: 'error'; text: string }> }) => () => void } | undefined
  if (commandRuntime !== undefined) {
    ctx.effect(() => commandRuntime.register({
      name: 'skill-domain',
      description: 'List provisional skill domains or confirm one by id.',
      async handler({ rawInput }) {
        const [action, domainId] = rawInput.trim().split(/\s+/)
        if (action === 'list' || action === undefined) {
          const snapshot = await map.read()
          const provisional = snapshot.domains.filter(node => node.status === 'provisional')
          return { kind: 'success' as const, text: provisional.length === 0 ? 'No provisional domains.' : 'Provisional domains:\n' + provisional.map(node => '- ' + node.id + ': ' + node.name).join('\n') }
        }
        if (action === 'confirm' && domainId !== undefined) {
          const confirmed = await assignment.confirm(domainId)
          return confirmed ? { kind: 'success' as const, text: 'Confirmed domain ' + domainId + '.' } : { kind: 'error' as const, text: 'Unknown or non-provisional domain: ' + domainId }
        }
        return { kind: 'error' as const, text: 'Usage: /skill-domain list | /skill-domain confirm <id>' }
      },
    }))
  }
  const searchCache = new SkillSearchCache()
  ctx.on('evolution/skill-mutated', () => { searchCache.clear() })
  registerSkillSearchTool(ctx, {
    async allowedSkillKeys(agent) {
      const view = await new SkillIndex(source).read({ cwd: agent?.session.header.cwd ?? process.cwd(), scopeKey: agent === undefined ? 'tool' : String(agent.id), ...agent === undefined ? {} : { scope: agent } })
      const snapshot = await map.read()
      const blocked = new Set(snapshot.edges.filter(edge => edge.status === 'active' && policy.disabled.has(edge.domainId)).map(edge => edge.skillKey))
      return new Set(view.rows.filter(row => row.modelInvocable && !blocked.has(row.skillKey)).map(row => row.skillKey))
    },
    async search(query, options, agent) {
      const cwd = agent?.session.header.cwd ?? process.cwd()
      const view = await new SkillIndex(source).read({ cwd, scopeKey: agent === undefined ? 'tool' : String(agent.id), ...agent === undefined ? {} : { scope: agent } })
      const cacheKey = { viewKey: view.viewKey, viewCatalogDigest: view.viewCatalogDigest, policyDigest, discoveryMode: config.mode ?? 'auto' }
      const cached = await searchCache.get(cacheKey, view.rows)
      if (cached === undefined) return { results: [], truncated: false, degraded: true, hint: 'Skill search index is unavailable. Use skill(name) or the full catalog.' }
      const result = await cached.index.search(query, options)
      return result.stale || cached.stale ? { ...result, stale: true } : result
    },
  })

}
