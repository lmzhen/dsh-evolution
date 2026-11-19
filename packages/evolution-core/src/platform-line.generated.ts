// GENERATED FILE — do not edit. Source: platform-line.json (repository root) (generator: packages/scripts/gen-platform-line.mjs).
// Regenerate with: node packages/scripts/gen-platform-line.mjs
/** The frozen platform line this release targets (peers/engines/anchors derived from version+floor). */
export const PLATFORM_LINE = {
  version: '0.2.2-rc.5',
  floor: '0.2.2-rc.2',
  cohort: [
    '0.2.2-rc.2',
    '0.2.2-rc.3',
    '0.2.2-rc.4',
    '0.2.2-rc.5',
  ],
  contract: 1,
  previousAnchor: '0.2.1-rc.2',
  peersRange: '0.2.2-rc.2 || 0.2.2-rc.3 || 0.2.2-rc.4 || 0.2.2-rc.5',
  enginesRange: '0.2.2-rc.2 || 0.2.2-rc.3 || 0.2.2-rc.4 || 0.2.2-rc.5',
  upstreamRef: 'dsh-v0.2.2-rc.5',
} as const
