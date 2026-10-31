/** Persisted discovery metadata used to keep old sessions full-catalog. */
export interface DiscoverySessionMeta {
  readonly discoveryMode?: 'off' | 'shadow' | 'on' | undefined
  readonly featureEpoch?: string | undefined
}

/** @returns true only for a new, fully-enabled session in the current epoch. */
export function shouldHideCatalog(meta: DiscoverySessionMeta | undefined, currentFeatureEpoch: string): boolean {
  return meta?.discoveryMode === 'on' && meta.featureEpoch === currentFeatureEpoch
}

/** @returns true when awareness may be emitted (shadow or on). */
export function shouldEmitAwareness(meta: DiscoverySessionMeta | undefined, currentFeatureEpoch: string): boolean {
  return (meta?.discoveryMode === 'on' || meta?.discoveryMode === 'shadow') && meta.featureEpoch === currentFeatureEpoch
}

/** @returns false when the same digest was already emitted in this session. */
export function shouldEmitDigest(previousDigest: string | undefined, nextDigest: string): boolean {
  return previousDigest !== nextDigest
}

/** @returns off at <=2200 tokens, on at >=3000, shadow between. */
export function projectionBudgetMode(catalogTokens: number, promoted = false): 'off' | 'shadow' | 'on' {
  if (catalogTokens <= 2200) return 'off'
  if (promoted && catalogTokens >= 3000) return 'on'
  return 'shadow'
}

/** @returns true when a resumed session already enabled discovery. */
export function shouldInstallAwarenessOnResume(record: { readonly discoveryMode: 'off' | 'shadow' | 'on'; readonly featureEpoch: string } | undefined, featureEpoch: string): boolean {
  return record !== undefined && record.discoveryMode !== 'off' && record.featureEpoch === featureEpoch
}
