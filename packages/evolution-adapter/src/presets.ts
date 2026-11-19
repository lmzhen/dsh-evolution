/**
 * The agent-preset half of the family's host platform boundary.
 *
 * Restricted presets need the registry's document/register face; the review
 * branch needs resolve/mount; the restrictor needs composedPreset. The
 * platform service is optional, so every method is reached through one facade.
 */
import type { Context } from '@deepseek-ai/cordis'

export interface PresetDocument {
  readonly agentPreset: string
  readonly content: string
}

export interface PresetDefinitionLike {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly order: number
  readonly plugins: readonly unknown[]
}

export interface PresetsPort {
  readDocument(agentPreset: string): Promise<PresetDocument>
  register(definition: PresetDefinitionLike): Promise<() => Promise<void>>
  resolve(id?: string): Promise<{ readonly id: string }>
  mount(target: Context, id?: string): Promise<unknown>
  composedPreset(target: Context): string | undefined
}

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
