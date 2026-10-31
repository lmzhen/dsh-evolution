/** Discovery feature gates; v0 defaults everything off. */
export type DiscoveryMode = 'off' | 'shadow' | 'on'

export interface DiscoveryFeatureConfig {
  readonly projectionEnabled: boolean
  readonly searchEnabled: boolean
  readonly createClassificationEnabled: boolean
  readonly discoveryMode: DiscoveryMode
}

export const V0_DISCOVERY_FEATURES: DiscoveryFeatureConfig = Object.freeze({
  projectionEnabled: false,
  searchEnabled: false,
  createClassificationEnabled: false,
  discoveryMode: 'off',
})

export function canClassifyAtCreate(config: DiscoveryFeatureConfig, hasCreateDomainCards: boolean): boolean {
  return config.createClassificationEnabled && hasCreateDomainCards
}
