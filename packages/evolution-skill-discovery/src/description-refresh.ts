import type { DomainMapStore } from './domain-map.ts'
import { descriptionHashOf, renderDomainDescription } from './domain-description.ts'

function nextMapVersion(version: string): string {
  const numeric = Number(version)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric + 1) : version + '.1'
}

/**
 * Re-render stale domain descriptions from their definition fields.
 * @param store - domain map store.
 * @returns number of refreshed domains.
 */
export async function refreshStaleDescriptions(store: DomainMapStore): Promise<number> {
  const snapshot = await store.read()
  const stale = snapshot.domains.filter(node => node.descriptionStatus === 'stale')
  if (stale.length === 0) return 0
  const now = Date.now()
  const domains = snapshot.domains.map(node => node.descriptionStatus !== 'stale' ? node : {
    ...node,
    description: renderDomainDescription(node),
    descriptionHash: descriptionHashOf(node, snapshot.domains.filter(child => child.parentIds.includes(node.id))),
    descriptionVersion: node.descriptionVersion + 1,
    descriptionStatus: 'fresh' as const,
    updatedAt: now,
  })
  await store.commit(snapshot.mapVersion, { mapVersion: nextMapVersion(snapshot.mapVersion), domains, edges: snapshot.edges })
  return stale.length
}
