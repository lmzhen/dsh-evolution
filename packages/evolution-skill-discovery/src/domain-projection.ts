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
  readonly mode?: 'off' | 'on' | undefined
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
  readonly descriptionStaleAfterHours?: number | undefined
}

function qualityPasses(node: DomainNode, domains: readonly DomainNode[]): boolean {
  return evaluateDomainQuality(node, domains.filter(peer => peer.id !== node.id)).passed
}

export function buildDomainProjection(input: DomainProjectionInput): ProjectionResult {
  const mode = input.mode ?? 'on'
  if (mode === 'off') return projectCatalog({ entries: input.entries, rows: input.rows, activeManagedSkillKeys: new Set(), cards: [], viewKey: input.viewKey, scope: input.scope, mapVersion: input.mapVersion, policyDigest: input.policyDigest, viewCatalogDigest: input.viewCatalogDigest, adapterVersion: input.adapterVersion, projectionSchemaVersion: input.projectionSchemaVersion, discoveryMode: input.discoveryMode, complete: false })
  const staleByAge = input.staleAfterHours !== undefined && input.snapshot.domains.some(node => input.now !== undefined && input.now - node.updatedAt > input.staleAfterHours! * 3_600_000)
  const mapStale = input.mapStale === true || staleByAge
  const structurallyComplete = input.complete
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
  const staleEdgeDomains = new Set(input.snapshot.edges.filter(edge => edge.status === 'active' && edge.role === 'primary' && rowByKey.get(edge.skillKey) !== undefined && edge.skillHash !== rowByKey.get(edge.skillKey)!.threeFieldHash).map(edge => edge.domainId))
  const linkedKeys = new Set(input.snapshot.edges.filter(edge => edge.status === 'active' || edge.status === 'pending').map(edge => edge.skillKey))
  const unclassifiedCount = input.rows.filter(row => row.modelInvocable && !linkedKeys.has(row.skillKey)).length
  const domains = input.snapshot.domains.filter(node => node.status === 'active' || node.status === 'provisional')
  const cardDomains = domains
    .filter(node => node.parentIds.length === 0)
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
      const row = rowByKey.get(edge.skillKey)
      if (row === undefined) continue
      if (edge.status === 'pending') { pendingCount += 1; continue }
      if (edge.status !== 'active') continue
      if (row.managed && row.modelInvocable && !row.protected && !row.pinned) managedModelInvocableCount += 1
      else if (!row.managed) externalCatalogCount += 1
    }
    return {
      id: node.id,
      title: node.name,
      purpose: node.purpose.slice(0, 80),
      descriptionStatus: node.descriptionStatus === 'fresh' && input.descriptionStaleAfterHours !== undefined && input.now !== undefined && input.now - node.updatedAt > input.descriptionStaleAfterHours * 3_600_000 ? 'stale' : node.descriptionStatus,
      triggers: node.triggers.slice(0, 3),
      managedModelInvocableCount,
      externalCatalogCount,
      managedCount: managedModelInvocableCount,
      externalCount: externalCatalogCount,
      pendingCount,
      unclassifiedCount,
      state: node.status === 'provisional' ? 'provisional' : 'active',
      asOf: new Date(node.updatedAt).toISOString(),
      mapVersion: input.mapVersion,
      mapStale: mapStale || staleEdgeDomains.has(node.id),
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
    if (edge.skillHash !== row.threeFieldHash) continue
    if (input.policy.disabled.has(node.id)) continue
    wouldHide.add(edge.skillKey)
  }
  const activeManaged = mode === 'on' && !mapStale && input.searchAvailable !== false && input.policy.degraded.length === 0 ? wouldHide : new Set<SkillKey>()
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
  return projected
}

