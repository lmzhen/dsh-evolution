import type { DomainMapSnapshot, DomainNode } from './domain-map.ts'
import type { EffectiveDomainPolicy } from './domain-policy.ts'
import type { SkillIndexRow, SkillKey } from './identity.ts'
import { evaluateDomainQuality } from './domain-quality.ts'
import { projectCatalog, type CatalogEntry, type DomainCard, type ProjectionResult } from './projection.ts'

/** Input for one view's domain/catalog projection. */
export interface DomainProjectionInput {
  readonly entries: readonly CatalogEntry[]
  readonly rows: readonly SkillIndexRow[]
  readonly complete: boolean
  readonly mapStale?: boolean | undefined
  readonly searchAvailable?: boolean | undefined
  readonly mode?: 'off' | 'shadow' | 'on' | undefined
  readonly snapshot: DomainMapSnapshot
  readonly policy: EffectiveDomainPolicy
  readonly viewKey: string
  readonly scope: string
  readonly mapVersion: string
  readonly policyDigest: string
  readonly viewCatalogDigest: string
  readonly adapterVersion: string
  readonly projectionSchemaVersion: string
  readonly discoveryMode: string
  readonly maxCards?: number | undefined
  readonly tokenBudget?: number | undefined
  readonly now?: number | undefined
  readonly staleAfterHours?: number | undefined
  readonly maxVisibleDepth?: number | undefined
}

function qualityPasses(node: DomainNode, domains: readonly DomainNode[]): boolean {
  return evaluateDomainQuality(node, domains.filter(peer => peer.id !== node.id)).passed
}

/**
 * Build L1 cards and the hidden set for one view, then delegate the pure
 * catalog rewrite. Structural staleness fails open; description staleness does not.
 * @param input - rows, domain facts, policy, and identity inputs.
 * @returns projection result with cards and hidden names.
 */
export function hiddenRecoverable(hiddenNames: readonly string[], searchResultNames: ReadonlySet<string>): boolean {
  return hiddenNames.every(name => searchResultNames.has(name))
}

export function buildDomainProjection(input: DomainProjectionInput): ProjectionResult {
  const mode = input.mode ?? 'on'
  if (mode === 'off') return projectCatalog({ entries: input.entries, rows: input.rows, activeManagedSkillKeys: new Set(), cards: [], viewKey: input.viewKey, scope: input.scope, mapVersion: input.mapVersion, policyDigest: input.policyDigest, viewCatalogDigest: input.viewCatalogDigest, adapterVersion: input.adapterVersion, projectionSchemaVersion: input.projectionSchemaVersion, discoveryMode: input.discoveryMode, complete: false })
  const staleByAge = input.staleAfterHours !== undefined && input.snapshot.domains.some(node => input.now !== undefined && input.now - node.updatedAt > input.staleAfterHours! * 3_600_000)
  const mapStale = input.mapStale === true || staleByAge
  const structurallyComplete = input.complete && !mapStale && input.searchAvailable !== false
  if (!structurallyComplete) {
    return projectCatalog({
      entries: input.entries,
      rows: input.rows,
      activeManagedSkillKeys: new Set(),
      cards: [],
      viewKey: input.viewKey,
      scope: input.scope,
      mapVersion: input.mapVersion,
      policyDigest: input.policyDigest,
      viewCatalogDigest: input.viewCatalogDigest,
      adapterVersion: input.adapterVersion,
      projectionSchemaVersion: input.projectionSchemaVersion,
      discoveryMode: input.discoveryMode,
      complete: false,
    })
  }
  const rowByKey = new Map<SkillKey, SkillIndexRow>(input.rows.map(row => [row.skillKey, row]))
  const domains = input.snapshot.domains.filter(node => node.status === 'active' || node.status === 'provisional')
  const cardDomains = domains
    .filter(node => node.parentIds.length <= (input.maxVisibleDepth ?? 3) - 1 && node.parentIds.length === 0)
    .filter(node => !input.policy.disabled.has(node.id))
    .filter(node => input.policy.pinned.has(node.id) || qualityPasses(node, domains))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .slice(0, Math.max(1, input.maxCards ?? 12))
  const domainById = new Map(domains.map(node => [node.id, node]))
  const cards: DomainCard[] = cardDomains.map(node => {
    let managedModelInvocableCount = 0
    let externalCatalogCount = 0
    let pendingCount = 0
    for (const edge of input.snapshot.edges) {
      if (edge.domainId !== node.id) continue
      if (edge.status === 'pending') { pendingCount += 1; continue }
      if (edge.status !== 'active') continue
      const row = rowByKey.get(edge.skillKey)
      if (row === undefined) continue
      if (row.managed && row.modelInvocable && !row.protected && !row.pinned) managedModelInvocableCount += 1
      else if (!row.managed) externalCatalogCount += 1
    }
    return {
      id: node.id,
      title: node.name,
      purpose: node.purpose.slice(0, 80),
      descriptionStatus: node.descriptionStatus,
      triggers: node.triggers.slice(0, 3),
      managedModelInvocableCount,
      externalCatalogCount,
      managedCount: managedModelInvocableCount,
      externalCount: externalCatalogCount,
      pendingCount,
      state: node.status === 'provisional' ? 'provisional' : 'active',
      asOf: new Date(node.updatedAt).toISOString(),
      mapVersion: input.mapVersion,
      mapStale,
    }
  })
  const budget = input.tokenBudget
  if (budget !== undefined && budget > 0) {
    while (cards.length > 1 && Math.ceil(JSON.stringify(cards).length / 4) > budget) cards.pop()
  }
  const cardIds = new Set(cards.map(card => card.id))
  const wouldHide = new Set<SkillKey>()
  for (const edge of input.snapshot.edges) {
    if (edge.status !== 'active' || edge.role !== 'primary') continue
    const node = domainById.get(edge.domainId)
    const row = rowByKey.get(edge.skillKey)
    if (node === undefined || row === undefined) continue
    if (node.status !== 'active' || !cardIds.has(node.id) || !row.managed || !row.modelInvocable || row.protected || row.pinned) continue
    if (input.policy.disabled.has(node.id)) continue
    wouldHide.add(edge.skillKey)
  }
  const activeManaged = mode === 'on' ? wouldHide : new Set<SkillKey>()
  const projected = projectCatalog({
    entries: input.entries,
    rows: input.rows,
    activeManagedSkillKeys: activeManaged,
    cards,
    viewKey: input.viewKey,
    scope: input.scope,
    mapVersion: input.mapVersion,
    policyDigest: input.policyDigest,
    viewCatalogDigest: input.viewCatalogDigest,
    adapterVersion: input.adapterVersion,
    projectionSchemaVersion: input.projectionSchemaVersion,
    discoveryMode: input.discoveryMode,
    complete: true,
  })
  return mode === 'on' ? projected : { ...projected, shadowHiddenNames: [...wouldHide], shadowRecoveredNames: [...wouldHide] }
}

/** @returns true when shadow evidence is sufficient to promote to on. */
export function canPromoteShadow(input: { readonly samples: number; readonly hiddenRecoverableRate: number; readonly silentMisses: number }): boolean {
  return input.samples >= 20 && input.hiddenRecoverableRate >= 1 && input.silentMisses === 0
}
