import type { SkillKey } from './identity.ts'

/** One domain fact node; id is stable and never renamed by policy. */
export interface DomainNode {
  readonly id: string
  readonly name: string
  readonly purpose: string
  readonly description: string
  readonly inScope: readonly string[]
  readonly outOfScope: readonly string[]
  readonly triggers: readonly string[]
  readonly parentIds: readonly string[]
  readonly status: 'active' | 'provisional' | 'deprecated'
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
  /** When the description last changed; absent on maps written before this field. */
  readonly descriptionUpdatedAt?: number | undefined
  readonly descriptionHash: string
  readonly descriptionVersion: number
  readonly descriptionStatus: 'fresh' | 'stale' | 'failed'
  readonly provenance: Readonly<Record<string, string>>
  readonly quality: Readonly<Record<string, number>>
}

/** The next CAS version. ONE implementation: non-numeric versions get a suffix,
 * never NaN, and every writer advances the same way. */
export function nextMapVersion(version: string): string {
  const numeric = Number(version)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric + 1) : version + '.1'
}

/** One skill-domain edge; skillKey is the global identity, not a display name. */
export interface SkillDomainEdge {
  readonly skillKey: SkillKey
  readonly domainId: string
  readonly role: 'primary' | 'secondary'
  readonly confidence: number
  readonly source: 'create' | 'manual' | 'maintenance'
  readonly skillHash: string
  readonly mapVersion: string
  readonly status: 'active' | 'stale' | 'pending'
  readonly assignedAt: number
}

/** Immutable view of the domain fact store. */
export interface DomainMapSnapshot {
  readonly mapVersion: string
  readonly domains: readonly DomainNode[]
  readonly edges: readonly SkillDomainEdge[]
}

/** A committed domain-map write. */
export interface DomainMapWrite {
  readonly mapVersion: string
  readonly domains: readonly DomainNode[]
  readonly edges: readonly SkillDomainEdge[]
}

/** Owner contract; G1 supplies the JSON-backed implementation. */
export interface DomainMapStore {
  read(): Promise<DomainMapSnapshot>
  commit(expectedMapVersion: string, next: DomainMapWrite): Promise<DomainMapSnapshot>
  rollback(): Promise<DomainMapSnapshot>
}
