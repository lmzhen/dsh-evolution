/**
 * The agent-preset half of the family's platform contract.
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
