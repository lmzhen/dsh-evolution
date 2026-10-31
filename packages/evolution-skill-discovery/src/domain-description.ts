import { createHash } from 'node:crypto'
import type { DomainNode } from './domain-map.ts'

/** Description lifecycle; stale is still servable, failed is not a new description. */
export type DescriptionStatus = 'fresh' | 'stale' | 'failed'

/** Events allowed to regenerate a domain description. */
export type DescriptionRegenerationEvent = 'new' | 'split' | 'merge' | 'definition' | 'children' | 'skill-add'

/** @returns true only for structural/definition events; normal skill add does not rewrite. */
export function shouldRegenerateDescription(event: DescriptionRegenerationEvent): boolean {
  return event !== 'skill-add'
}

/** @returns true when the existing description may still serve. */
export function descriptionIsServable(status: DescriptionStatus): boolean {
  return status === 'fresh' || status === 'stale'
}

/** @returns hash of child ids/description versions, never member skill names. */
export function descriptionHashOf(domain: Pick<DomainNode, 'id' | 'descriptionVersion'>, children: readonly Pick<DomainNode, 'id' | 'descriptionVersion'>[]): string {
  const childRefs = children.map(child => JSON.stringify([child.id, child.descriptionVersion])).sort()
  return createHash('sha256').update(JSON.stringify([domain.id, domain.descriptionVersion, childRefs])).digest('hex')
}

/**
 * Render a domain description from definition fields only. It never appends
 * evidence/member skill names and is capped to 600 characters.
 * @param domain - domain definition.
 * @returns description text.
 */
export function renderDomainDescription(domain: Pick<DomainNode, 'name' | 'purpose' | 'inScope' | 'outOfScope' | 'triggers'>): string {
  const text = [
    domain.name + '：' + domain.purpose,
    '适用：' + domain.inScope.join('；'),
    '不适用：' + domain.outOfScope.join('；'),
    '触发：' + domain.triggers.join('；'),
  ].join('\n')
  return text.slice(0, 600)
}
