import type { DomainMapSnapshot } from './domain-map.ts'
import type { SkillKey } from './identity.ts'

/** Optional labels for assignment accuracy; absent means unmeasured. */
export interface DomainMetricLabels {
  readonly expectedBySkill: Readonly<Record<SkillKey, string>>
  readonly predictedBySkill: Readonly<Record<SkillKey, string>>
  readonly newDomainIds?: readonly string[] | undefined
  readonly predictedNewDomainIds?: readonly string[] | undefined
}

/** Recomputable domain/assignment metrics; no sentence locking. */
export interface DomainMetricCounters {
  readonly descriptionRewritten?: number | undefined
  readonly descriptionEligible?: number | undefined
  readonly refusedAssignments?: number | undefined
  readonly assignmentAttempts?: number | undefined
  readonly maxDomainsPerSkill?: number | undefined
}

/** Recomputable domain/assignment metrics; no sentence locking. */
export interface DomainMetrics {
  readonly measured: boolean
  readonly visibleSkills: number
  readonly coverage: number | null
  readonly unclassifiedRatio: number | null
  readonly emptyDomainCount: number
  readonly crossDomainRatio: number | null
  readonly pendingRate: number | null
  readonly assignmentAccuracy: number | null
  readonly newDomainPrecision: number | null
  readonly descriptionRewriteRate: number | null
  readonly staleDescriptionRatio: number | null
  readonly overAssignmentRate: number | null
  readonly refusalRate: number | null
}

/**
 * @param snapshot - domain facts.
 * @param visibleSkillKeys - skills visible in this view.
 * @param labels - optional assignment labels.
 * @returns metrics; null means the denominator is zero/unmeasured.
 */
export function computeDomainMetrics(snapshot: DomainMapSnapshot, visibleSkillKeys: ReadonlySet<SkillKey>, labels?: DomainMetricLabels, counters?: DomainMetricCounters): DomainMetrics {
  const visible = visibleSkillKeys.size
  const primary = new Set<SkillKey>()
  const domainsWithActiveMembers = new Set<string>()
  let activeEdges = 0
  let pendingEdges = 0
  const memberships = new Map<SkillKey, number>()
  for (const edge of snapshot.edges) {
    if (edge.status === 'pending') pendingEdges += 1
    if (edge.status !== 'active') continue
    activeEdges += 1
    if (!visibleSkillKeys.has(edge.skillKey)) continue
    if (edge.role === 'primary') primary.add(edge.skillKey)
    domainsWithActiveMembers.add(edge.domainId)
    memberships.set(edge.skillKey, (memberships.get(edge.skillKey) ?? 0) + 1)
  }
  const crossDomain = [...memberships.values()].filter(count => count > 1).length
  const emptyDomainCount = snapshot.domains.filter(domain => !domainsWithActiveMembers.has(domain.id)).length
  const assignmentAccuracy = labels === undefined ? null : accuracy(labels)
  const staleDescriptions = snapshot.domains.filter(domain => domain.descriptionStatus === 'stale').length
  const overAssigned = counters?.maxDomainsPerSkill === undefined ? null : [...memberships.values()].filter(count => count > counters.maxDomainsPerSkill!).length
  return {
    measured: visible > 0,
    visibleSkills: visible,
    coverage: visible === 0 ? null : primary.size / visible,
    unclassifiedRatio: visible === 0 ? null : (visible - primary.size) / visible,
    emptyDomainCount,
    crossDomainRatio: primary.size === 0 ? null : crossDomain / primary.size,
    pendingRate: activeEdges + pendingEdges === 0 ? null : pendingEdges / (activeEdges + pendingEdges),
    assignmentAccuracy,
    newDomainPrecision: labels?.newDomainIds === undefined || labels.predictedNewDomainIds === undefined || labels.newDomainIds.length === 0 ? null : precision(labels.newDomainIds, labels.predictedNewDomainIds),
    descriptionRewriteRate: counters?.descriptionEligible === undefined || counters.descriptionEligible === 0 ? null : (counters.descriptionRewritten ?? 0) / counters.descriptionEligible,
    staleDescriptionRatio: snapshot.domains.length === 0 ? null : staleDescriptions / snapshot.domains.length,
    overAssignmentRate: overAssigned === null || visible === 0 ? null : overAssigned / visible,
    refusalRate: counters?.assignmentAttempts === undefined || counters.assignmentAttempts === 0 ? null : (counters.refusedAssignments ?? 0) / counters.assignmentAttempts,
  }
}

function accuracy(labels: DomainMetricLabels): number | null {
  const keys = Object.keys(labels.expectedBySkill).filter(key => labels.predictedBySkill[key] !== undefined)
  if (keys.length === 0) return null
  return keys.filter(key => labels.expectedBySkill[key] === labels.predictedBySkill[key]).length / keys.length
}

function precision(expected: readonly string[], predicted: readonly string[]): number | null {
  if (predicted.length === 0) return null
  const wanted = new Set(expected)
  return predicted.filter(id => wanted.has(id)).length / predicted.length
}
