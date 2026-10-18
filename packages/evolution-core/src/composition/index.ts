// Composition subpath: the ONE preset-composer surface plus the restricted-preset contract.
// G2-S1 physically moves ../preset-composition.ts into ./composer.ts; until then this file
// re-exports the single implementation so no second composer exists.
export * from '../preset-composition.ts'

import type { Context } from '@deepseek-ai/cordis'

export type RestrictedPresetKind = 'reviewer' | 'maintainer'

// Derived from bases.json (single source: packages/evolution-agent/bases.json).
export const EVOLUTION_PRESET_IDS = ["evolution","evolution-ptc","evolution-cordis","evolution-minimal"] as const
export const REVIEWER_PRESET_ID = 'evolution-reviewer-readonly' as const
export const MAINTAINER_PRESET_ID = 'evolution-maintainer-readonly' as const
export const RESTRICTED_TOOLS_ROW_ID = 'evolution-restricted-tools' as const
export const RESTRICTOR_MODULE = '@deepseek-ai/dsh-evolution-core/restrictor'

export interface RestrictedPresetDisplay {
  readonly name: string
  readonly description: string
  readonly order: number
}

export const RESTRICTED_PRESET_DISPLAY: Readonly<Record<RestrictedPresetKind, RestrictedPresetDisplay>> = {
  reviewer: { name: 'evolution reviewer (read-only)', description: 'Internal restricted preset used by the family review channel.', order: 900 },
  maintainer: { name: 'evolution maintainer (read-only)', description: 'Internal restricted preset used by the family maintenance channel.', order: 901 },
}

export interface RestrictedPresetRequest {
  readonly kind: RestrictedPresetKind
  readonly parentPresetId: string
  readonly allow: readonly string[]
}

export type RestrictedPresetState =
  | { readonly kind: 'ready'; readonly presetId: string; readonly parentPresetId: string; readonly allow: readonly string[] }
  | { readonly kind: 'failed'; readonly code: 'E-324'; readonly reason: string }

// G2-S5 implements the single-flight lifecycle; contract skeleton only until then.
export function ensureRestrictedPreset(_ctx: Context, _req: RestrictedPresetRequest): Promise<RestrictedPresetState> {
  throw new Error('ensureRestrictedPreset is not implemented until G2-S5')
}
