/**
 * The agent-preset implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinitionLike, PresetDocument, PresetsPort } from '@deepseek-ai/dsh-evolution-platform-contract'

export type { PresetDefinitionLike, PresetDocument, PresetsPort } from '@deepseek-ai/dsh-evolution-platform-contract'

interface RegistryLike {
  readDocument?(agentPreset: string): Promise<PresetDocument>
  register?(definition: PresetDefinitionLike): Promise<() => Promise<void>>
  resolve?(id?: string): Promise<{ readonly id: string }>
  mount?(target: Context, id?: string): Promise<unknown>
  composedPreset?(target: Context): string | undefined
}

/** Resolve the preset registry facade; undefined when the host has no agentPresets service. */
export function presetsPort(ctx: Context): PresetsPort | undefined {
  // platform-declaration anchor: agentPresets is declared in core PLATFORM_SERVICE_PROBES.
  const registry = ctx.get('agentPresets') as RegistryLike | undefined
  if (registry === undefined) return undefined
  return {
    readDocument: (id) => {
      if (registry.readDocument === undefined) throw new Error('agentPresets service has no readDocument()')
      return registry.readDocument(id)
    },
    register: (definition) => {
      if (registry.register === undefined) throw new Error('agentPresets service has no register()')
      return registry.register(definition)
    },
    resolve: (id) => {
      if (registry.resolve === undefined) throw new Error('agentPresets service has no resolve()')
      return registry.resolve(id)
    },
    mount: (target, id) => {
      if (registry.mount === undefined) throw new Error('agentPresets service has no mount()')
      return registry.mount(target, id)
    },
    composedPreset: (target) => registry.composedPreset?.(target),
  }
}
