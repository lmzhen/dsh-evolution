import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DomainMapStore } from './domain-map.ts'
import type { EffectiveDomainPolicy } from './domain-policy.ts'
import { buildDomainProjection } from './domain-projection.ts'
import { SkillIndex, type SkillIndexSource } from './index.ts'
import type { CatalogEntry, ProjectionResult } from './projection.ts'
import { projectionBudgetMode, shouldEmitAwareness } from './session-projection.ts'
import type { DiscoverySessionStore } from './session-store.ts'

/** Injectable composition ports; the platform adapter supplies concrete I/O. */
export interface DiscoveryRuntimePorts {
  readonly skillIndexSource: SkillIndexSource
  readonly map: DomainMapStore
  readonly policy: EffectiveDomainPolicy
  readonly sessionStore: DiscoverySessionStore
  readonly featureEpoch: string
  readonly mapVersion: string
  readonly policyDigest: string
  readonly adapterVersion: string
  readonly projectionSchemaVersion: string
  readonly discoveryMode: string
  readonly maxCards?: number | undefined
  readonly tokenBudget?: number | undefined
  readonly autoMode?: boolean | undefined
  readonly promoted?: boolean | (() => boolean) | undefined
  readonly onProjection?: ((result: ProjectionResult) => void) | undefined
  readonly staleAfterHours?: number | undefined
  readonly maxVisibleDepth?: number | undefined
  readonly mode?: 'off' | 'shadow' | 'on' | undefined
  readonly mapStale?: boolean | undefined
  readonly searchAvailable?: boolean | undefined
}

/** G2 adapter provider wired from ports; no global platform dependency. */
export class DiscoveryRuntime {
  private readonly ports: DiscoveryRuntimePorts
  constructor(ports: DiscoveryRuntimePorts) { this.ports = ports }

  /** @returns true only when persisted session metadata allows projection. */
  async shouldProject(agent: Agent): Promise<boolean> {
    const meta = await this.ports.sessionStore.get(agent.session.id)
    return shouldEmitAwareness(meta, this.ports.featureEpoch)
  }

  /** @returns a complete projection for this agent's catalog entries. */
  async project(input: { readonly agent: Agent; readonly catalogEntries: readonly CatalogEntry[] }): Promise<ProjectionResult> {
    const index = new SkillIndex(this.ports.skillIndexSource)
    const view = await index.read({ cwd: input.agent.session.header.cwd ?? '', scopeKey: String(input.agent.id), scope: input.agent })
    const snapshot = await this.ports.map.read()
    const estimatedTokens = Math.ceil(input.catalogEntries.reduce((sum, entry) => sum + entry.name.length + entry.description.length, 0) / 4)
    const promoted = typeof this.ports.promoted === 'function' ? this.ports.promoted() : this.ports.promoted === true
    const autoMode = this.ports.autoMode === true ? projectionBudgetMode(estimatedTokens, promoted) : this.ports.mode
    const result = buildDomainProjection({
      entries: input.catalogEntries,
      rows: view.rows,
      complete: view.complete,
      snapshot,
      policy: this.ports.policy,
      viewKey: view.viewKey,
      scope: String(input.agent.id),
      mapVersion: snapshot.mapVersion,
      policyDigest: this.ports.policyDigest,
      viewCatalogDigest: view.viewCatalogDigest,
      adapterVersion: this.ports.adapterVersion,
      projectionSchemaVersion: this.ports.projectionSchemaVersion,
      discoveryMode: this.ports.autoMode === true ? (autoMode ?? 'shadow') : this.ports.discoveryMode,
      maxCards: this.ports.maxCards,
      tokenBudget: this.ports.tokenBudget,
      staleAfterHours: this.ports.staleAfterHours,
      maxVisibleDepth: this.ports.maxVisibleDepth,
      now: Date.now(),
      mode: autoMode,
      mapStale: this.ports.mapStale,
      searchAvailable: this.ports.searchAvailable,
    })
    this.ports.onProjection?.(result)
    return result
  }
}
