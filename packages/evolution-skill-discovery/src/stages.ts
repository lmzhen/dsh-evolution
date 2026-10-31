/** Ordered implementation stages from PLAN-DISC-001. */
export const DISCOVERY_STAGES = ['G0-projection', 'G1-domain', 'G2-projection', 'G3-search', 'G4-assignment', 'G5-maintenance', 'G6-ui', 'G7-migration', 'G8-release'] as const
export type DiscoveryStage = (typeof DISCOVERY_STAGES)[number]

export function stageIndex(stage: DiscoveryStage): number {
  return DISCOVERY_STAGES.indexOf(stage)
}

export function mayAdvance(current: DiscoveryStage, next: DiscoveryStage): boolean {
  return stageIndex(next) === stageIndex(current) + 1
}
