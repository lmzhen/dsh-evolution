// Capability probe for the subagent channel: one place decides available vs unavailable.
import type { Context } from '@deepseek-ai/cordis'
import type { EvolutionPlatform } from '../runtime/platform.ts'
import { restrictedPresetState } from '../composition/ensure.ts'
import { restrictedPresetId } from '../composition/preset-ids.ts'
import type { ChannelKind, ChannelState } from './types.ts'

interface ProviderLike {
  readonly name: string
  readonly capabilities?: { readonly agentPreset?: boolean }
  readonly inheritsParentContext?: boolean
}

/** Pure derivation (no side effects): the doctor reads this, the channel re-probes on every run. */
export function probeChannelState(ctx: Context, kind: ChannelKind): ChannelState {
  const platform = ctx.get('evolutionPlatform') as EvolutionPlatform | undefined
  const subagents = platform?.ports.subagents
  if (subagents === undefined) {
    return { kind: 'unavailable', code: 'E-323', reason: 'subagents service unavailable' }
  }
  const provider = subagents.getProvider('spawn') as ProviderLike | undefined
  if (provider === undefined) return { kind: 'unavailable', code: 'E-323', reason: 'spawn provider unavailable' }
  if (provider.capabilities?.agentPreset !== true) {
    return { kind: 'unavailable', code: 'E-323', reason: 'spawn provider lacks the agentPreset capability' }
  }
  if (provider.inheritsParentContext === true) {
    return { kind: 'unavailable', code: 'E-323', reason: 'spawn provider inherits the parent context (independent preset required)' }
  }
  const presets = platform?.ports.presets
  if (presets === undefined) {
    return { kind: 'unavailable', code: 'E-323', reason: 'agentPresets service unavailable or incomplete' }
  }
  const id = restrictedPresetId(kind)
  const state = restrictedPresetState(ctx, kind)
  return { kind: 'available', provider: 'spawn', preset: { id, registered: state?.kind === 'ready' } }
}
