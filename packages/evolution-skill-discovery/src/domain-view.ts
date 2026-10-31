import type { DomainMapSnapshot } from './domain-map.ts'
import type { SkillKey } from './identity.ts'

/** Per-view membership counts; unclassified is virtual, never a domain id. */
export interface DomainViewCounts {
  readonly byDomain: ReadonlyMap<string, number>
  readonly unclassified: number
}

/**
 * Count visible skills by active domain membership.
 * @param snapshot - global domain facts.
 * @param visibleSkillKeys - skill keys visible in this view.
 * @returns per-domain member counts plus the unclassified virtual count.
 */
export function domainViewCounts(snapshot: DomainMapSnapshot, visibleSkillKeys: ReadonlySet<SkillKey>): DomainViewCounts {
  const byDomain = new Map<string, Set<SkillKey>>()
  const classified = new Set<SkillKey>()
  for (const edge of snapshot.edges) {
    if (edge.status !== 'active' || !visibleSkillKeys.has(edge.skillKey)) continue
    const set = byDomain.get(edge.domainId) ?? new Set<SkillKey>()
    set.add(edge.skillKey)
    byDomain.set(edge.domainId, set)
    if (edge.role === 'primary') classified.add(edge.skillKey)
  }
  const counts = new Map<string, number>()
  for (const [domainId, members] of byDomain) counts.set(domainId, members.size)
  const unclassified = [...visibleSkillKeys].filter(key => !classified.has(key)).length
  return { byDomain: counts, unclassified }
}
