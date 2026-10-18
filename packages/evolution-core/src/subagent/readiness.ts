// Capability probe for the subagent channel: one place decides available vs unavailable.
import type { Context } from '@deepseek-ai/cordis'
import { restrictedPresetState } from '../composition/ensure.ts'
import { restrictedPresetId, type RestrictedPresetKind } from '../composition/preset-ids.ts'
import type { ChannelKind, ChannelState } from './types.ts'

interface ProviderLike {
  readonly name: string
  readonly capabilities?: { readonly agentPreset?: boolean }
  readonly inheritsParentContext?: boolean
}

interface SubagentsLike {
  getProvider(name: string): ProviderLike | undefined
}

function serviceOf(ctx: Context, name: string): unknown {
  return (ctx as unknown as { get(service: string): unknown }).get(name)
}

function kindOf(kind: ChannelKind): RestrictedPresetKind {
  return kind === 'reviewer' ? 'reviewer' : 'maintainer'
}

/** Pure derivation (no side effects): the doctor reads this, the channel re-probes on every run. */
export function probeChannelState(ctx: Context, kind: ChannelKind): ChannelState {
  const subagents = serviceOf(ctx, 'subagents') as SubagentsLike | undefined
  if (subagents === undefined || typeof subagents.getProvider !== 'function') {
    return { kind: 'unavailable', code: 'E-323', reason: 'subagents service unavailable' }
  }
  const provider = subagents.getProvider('spawn')
  if (provider === undefined) return { kind: 'unavailable', code: 'E-323', reason: 'spawn provider unavailable' }
  if (provider.capabilities?.agentPreset !== true) {
    return { kind: 'unavailable', code: 'E-323', reason: 'spawn provider lacks the agentPreset capability' }
  }
  if (provider.inheritsParentContext === true) {
    return { kind: 'unavailable', code: 'E-323', reason: 'spawn provider inherits the parent context (independent preset required)' }
  }
  const agentPresets = serviceOf(ctx, 'agentPresets') as { readDocument?: unknown; register?: unknown } | undefined
  if (agentPresets === undefined || typeof agentPresets.readDocument !== 'function' || typeof agentPresets.register !== 'function') {
    return { kind: 'unavailable', code: 'E-323', reason: 'agentPresets service unavailable or incomplete' }
  }
  const id = restrictedPresetId(kindOf(kind))
  const state = restrictedPresetState(ctx, kindOf(kind))
  return { kind: 'available', provider: 'spawn', preset: { id, registered: state?.kind === 'ready' } }
}

export function subagentChannelState(ctx: Context, kind: ChannelKind): ChannelState {
  return probeChannelState(ctx, kind)
}
