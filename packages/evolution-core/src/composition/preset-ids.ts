// The frozen preset identities and restricted-preset display/transport constants.
import { scopedPackageName } from '../package-identity.ts'

export type RestrictedPresetKind = 'reviewer' | 'maintainer' | 'governance'

// Derived from bases.json (single source: packages/evolution-agent/bases.json).
export const EVOLUTION_PRESET_IDS = ['evolution', 'evolution-ptc', 'evolution-cordis', 'evolution-minimal'] as const
export const REVIEWER_PRESET_ID = 'evolution-reviewer-readonly' as const
export const MAINTAINER_PRESET_ID = 'evolution-maintainer-readonly' as const
export const GOVERNANCE_PRESET_ID = 'evolution-governance' as const
export const RESTRICTED_TOOLS_ROW_ID = 'evolution-restricted-tools' as const
export const RESTRICTOR_MODULE = scopedPackageName('dsh-evolution-core/restrictor', import.meta.url)

export interface RestrictedPresetDisplay {
  readonly name: string
  readonly description: string
  readonly order: number
}

export const RESTRICTED_PRESET_DISPLAY: Readonly<Record<RestrictedPresetKind, RestrictedPresetDisplay>> = {
  reviewer: { name: 'evolution reviewer (read-only)', description: 'Internal restricted preset used by the family review channel.', order: 900 },
  maintainer: { name: 'evolution maintainer (read-only)', description: 'Internal restricted preset used by the family maintenance channel.', order: 901 },
  governance: { name: 'evolution governance (writable)', description: 'Internal restricted preset used by the single-skill governance child.', order: 902 },
}

export function restrictedPresetId(kind: RestrictedPresetKind): string {
  if (kind === 'reviewer') return REVIEWER_PRESET_ID
  if (kind === 'maintainer') return MAINTAINER_PRESET_ID
  return GOVERNANCE_PRESET_ID
}

/** Trim, drop blanks, de-duplicate and sort: ONE spelling for an allow/deny set. */
export function normalizeAllow(names: readonly string[]): readonly string[] {
  return [...new Set(names.map(name => name.trim()).filter(name => name !== ''))].sort()
}
