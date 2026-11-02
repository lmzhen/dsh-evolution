import type { DomainMapStore } from './domain-map.ts'
import { descriptionHashOf, renderDomainDescription } from './domain-description.ts'

function nextMapVersion(version: string): string {
  const numeric = Number(version)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric + 1) : version + '.1'
}

/**
 * Mark aged fresh descriptions stale so the refresh pass has a producer.
 * @param store - domain map store.
 * @param maxAgeHours - age threshold; undefined disables the producer.
 * @param now - clock for deterministic tests.
 * @returns number of domains marked stale.
 */
export async function markStaleDescriptions(store: DomainMapStore, maxAgeHours: number | undefined, now = Date.now()): Promise<number> {
  if (maxAgeHours === undefined || maxAgeHours < 0) return 0
  const snapshot = await store.read()
  const aged = snapshot.domains.filter(node => node.descriptionStatus === 'fresh' && node.updatedAt > 0 && now - node.updatedAt > maxAgeHours * 3_600_000)
  if (aged.length === 0) return 0
  const domains = snapshot.domains.map(node => aged.includes(node) ? { ...node, descriptionStatus: 'stale' as const } : node)
  await store.commit(snapshot.mapVersion, { mapVersion: nextMapVersion(snapshot.mapVersion), domains, edges: snapshot.edges })
  return aged.length
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
