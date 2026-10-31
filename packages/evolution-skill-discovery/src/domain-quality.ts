import type { DomainNode } from './domain-map.ts'

/** Stable quality issue codes. */
export type DomainQualityIssue = 'empty-purpose' | 'vague-purpose' | 'empty-in-scope' | 'empty-out-of-scope' | 'empty-triggers' | 'overlaps-peer' | 'indistinguishable'

/** Quality result is evidence, not an automatic mutation. */
export interface DomainQualityResult {
  readonly passed: boolean
  readonly issues: readonly DomainQualityIssue[]
  readonly score: number
}

function tokens(values: readonly string[]): Set<string> {
  return new Set(values.join(' ').toLowerCase().split(/[^\p{Letter}\p{Number}]+/u).filter(token => token.length > 0))
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1
  let overlap = 0
  for (const token of left) if (right.has(token)) overlap += 1
  return overlap / (left.size + right.size - overlap)
}

/**
 * Evaluate whether a domain definition is specific, triggered, and distinct.
 * @param domain - candidate domain.
 * @param peers - other visible domains.
 * @returns auditable issues; does not mutate the candidate.
 */
export function evaluateDomainQuality(domain: Pick<DomainNode, 'name' | 'purpose' | 'inScope' | 'outOfScope' | 'triggers'>, peers: readonly Pick<DomainNode, 'name' | 'purpose' | 'inScope' | 'outOfScope' | 'triggers'>[]): DomainQualityResult {
  const issues: DomainQualityIssue[] = []
  if (domain.purpose.trim().length === 0) issues.push('empty-purpose')
  else if (domain.purpose.trim().length < 8) issues.push('vague-purpose')
  if (domain.inScope.length === 0) issues.push('empty-in-scope')
  if (domain.outOfScope.length === 0) issues.push('empty-out-of-scope')
  if (domain.triggers.length === 0) issues.push('empty-triggers')
  const own = tokens([...domain.inScope, ...domain.triggers])
  for (const peer of peers) {
    if (domain.name.trim().toLowerCase() === peer.name.trim().toLowerCase() || domain.purpose.trim().toLowerCase() === peer.purpose.trim().toLowerCase()) {
      issues.push('indistinguishable')
      break
    }
    if (jaccard(own, tokens([...peer.inScope, ...peer.triggers])) > 0.8) {
      issues.push('overlaps-peer')
      break
    }
  }
  const unique = [...new Set(issues)]
  return { passed: unique.length === 0, issues: unique, score: Math.max(0, 1 - unique.length * 0.2) }
}
