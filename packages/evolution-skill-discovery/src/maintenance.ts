import type { DomainMapSnapshot, DomainNode } from './domain-map.ts'
import type { SkillKey } from './identity.ts'

/** Maintenance defaults from PLAN/MAP-009. */
export const MAINTENANCE_DEFAULTS = Object.freeze({ splitSkillThreshold: 25, coarsenDomainCount: 12, maxVisibleDepth: 3, minChildren: 2, minMembersPerChild: 3, coarsenMinDomains: 3, coarsenMaxDomains: 8 })

/** Read-only per-domain audit; no coverage claim is fabricated. */
export interface DomainAudit {
  readonly domainId: string
  readonly definitionComplete: boolean
  readonly childCount: number
  readonly directSkillCount: number
  readonly indirectSkillCount: number
  readonly empty: boolean
  readonly orphan: boolean
  readonly lastUpdated: number
}

/** Map-level audit. */
export interface DomainMapAudit {
  readonly domains: readonly DomainAudit[]
  readonly domainCount: number
  readonly unclassifiedCount: number
}

/** One split candidate; no domains/edges are created. */
export interface SplitCandidate {
  readonly domainId: string
  readonly directSkillCount: number
  readonly children: number
  readonly blockers: readonly string[]
}

/** One coarsen group; no edges are changed. */
export interface CoarsenGroup { readonly domainIds: readonly string[] }

function directMembers(snapshot: DomainMapSnapshot, domainId: string): Set<SkillKey> {
  return new Set(snapshot.edges.filter(edge => edge.status === 'active' && edge.domainId === domainId).map(edge => edge.skillKey))
}

function descendants(snapshot: DomainMapSnapshot, domainId: string): Set<string> {
  const result = new Set<string>()
  const queue = [domainId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const node of snapshot.domains) {
      if (!node.parentIds.includes(current) || result.has(node.id)) continue
      result.add(node.id)
      queue.push(node.id)
    }
  }
  return result
}

/**
 * Audit domain definitions/structure without mutating the map.
 * @param snapshot - domain facts.
 * @param visibleSkillKeys - optional view skills for unclassified count.
 * @returns per-domain audit plus map-level counts.
 */
export function auditDomainMap(snapshot: DomainMapSnapshot, visibleSkillKeys?: ReadonlySet<SkillKey>): DomainMapAudit {
  const ids = new Set(snapshot.domains.map(node => node.id))
  const primary = new Set<SkillKey>()
  for (const edge of snapshot.edges) if (edge.status === 'active' && edge.role === 'primary') primary.add(edge.skillKey)
  const domains = snapshot.domains.map((node: DomainNode): DomainAudit => {
    const direct = directMembers(snapshot, node.id)
    const indirect = new Set<SkillKey>()
    for (const child of descendants(snapshot, node.id)) for (const member of directMembers(snapshot, child)) indirect.add(member)
    const definitionComplete = node.purpose.trim().length > 0 && node.inScope.length > 0 && node.outOfScope.length > 0 && node.triggers.length > 0
    return { domainId: node.id, definitionComplete, childCount: snapshot.domains.filter(child => child.parentIds.includes(node.id)).length, directSkillCount: direct.size, indirectSkillCount: indirect.size, empty: direct.size === 0, orphan: node.parentIds.some(parent => !ids.has(parent)), lastUpdated: node.updatedAt }
  })
  const known = visibleSkillKeys ?? new Set(snapshot.edges.map(edge => edge.skillKey))
  const unclassifiedCount = [...known].filter(key => !primary.has(key)).length
  return { domains, domainCount: domains.length, unclassifiedCount }
}

/**
 * Find split candidates; no child domains are created and no skills are reassigned.
 * @param snapshot - domain facts.
 * @param threshold - minimum direct members to consider.
 * @returns candidates with blockers.
 */
export function splitCandidates(snapshot: DomainMapSnapshot, threshold = MAINTENANCE_DEFAULTS.splitSkillThreshold): readonly SplitCandidate[] {
  return snapshot.domains.flatMap(node => {
    const direct = directMembers(snapshot, node.id).size
    if (direct < threshold) return []
    const children = Math.min(MAINTENANCE_DEFAULTS.coarsenMaxDomains, Math.floor(direct / MAINTENANCE_DEFAULTS.minMembersPerChild))
    const blockers: string[] = []
    if (children < MAINTENANCE_DEFAULTS.minChildren) blockers.push('fewer-than-2-children')
    return [{ domainId: node.id, directSkillCount: direct, children, blockers }]
  })
}

/**
 * Find coarsen groups; only structure candidates, never edge rewrites.
 * @param snapshot - domain facts.
 * @param maxDomains - above this count coarsening is considered.
 * @returns groups of 3–8 domains, at least 2 groups.
 */
export function coarsenCandidates(snapshot: DomainMapSnapshot, maxDomains = MAINTENANCE_DEFAULTS.coarsenDomainCount): readonly CoarsenGroup[] {
  if (snapshot.domains.length <= maxDomains) return []
  const ids = snapshot.domains.map(node => node.id).sort()
  const size = Math.min(MAINTENANCE_DEFAULTS.coarsenMaxDomains, Math.max(MAINTENANCE_DEFAULTS.coarsenMinDomains, Math.ceil(ids.length / 2)))
  const groups: CoarsenGroup[] = []
  for (let index = 0; index < ids.length; index += size) groups.push({ domainIds: ids.slice(index, index + size) })
  return groups.length >= 2 ? groups : []
}
