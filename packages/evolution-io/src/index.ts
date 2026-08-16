/**
 * IO seam for evolution providers.
 * @module @deepseek-ai/dsh-evolution-io
 */

import { Context, Service } from '@deepseek-ai/cordis'

export interface EvolutionIo {
  readonly name: string
  readText(path: string, signal?: AbortSignal): Promise<string | null>
  writeText(path: string, content: string, signal?: AbortSignal): Promise<void>
  remove(path: string): Promise<void>
  list(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  rename(path: string, destination: string): Promise<void>
  copy(path: string, destination: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionIo: EvolutionIoRegistry
  }
}

export class EvolutionIoRegistry extends Service {
  private readonly providers = new Map<string, EvolutionIo>()

  constructor(ctx: Context) {
    super(ctx, 'evolutionIo')
  }

  registerProvider(provider: EvolutionIo): () => void {
    if (this.providers.has(provider.name)) throw new Error(`evolution IO provider "${provider.name}" already registered`)
    this.providers.set(provider.name, provider)
    return () => {
      if (this.providers.get(provider.name) === provider) this.providers.delete(provider.name)
    }
  }

  provider(name?: string): EvolutionIo {
    if (name) {
      const provider = this.providers.get(name)
      if (provider) return provider
      throw new Error(`evolution IO provider "${name}" is not registered`)
    }
    const first = this.providers.values().next().value
    if (!first) throw new Error('no evolution IO provider registered')
    return first
  }
}

export default EvolutionIoRegistry
