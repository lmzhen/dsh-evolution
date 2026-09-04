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
  /**
   * Optional byte-size probe for the read guard. Return the file's size in
   * bytes, or `null` when unknown (unsupported backend, missing file, stat
   * failure). An implementation without this probe gets no read guard.
   */
  size?(path: string, signal?: AbortSignal): Promise<number | null>
  /**
   * Optional atomic read-modify-write (rc.50 P2-2): the read and the write run
   * inside a single cross-process lock so two processes sharing DSH_HOME
   * cannot interleave their RMW sequences. Backends without it fall back to
   * plain read+write and the consumer keeps its single-process chain as the
   * second layer. Mirrors `EvolutionIoLike.transact` in core — providers that
   * implement it (e.g. `nodeEvolutionIo`) expose it here, and consumers read
   * it through `transactIo` / the evolution IO adapter.
   */
  transact?(this: void, path: string, task: (current: string | null) => Promise<string | null>): Promise<void>
  /**
   * Optional symlink probe (G7). `true` = the path is a symlink, `false` = a
   * real entry, `null` = guard not applicable. Consumers treat `null` as
   * "let it through". Mirrors `EvolutionIoLike.isSymlink`.
   */
  isSymlink?(this: void, path: string): Promise<boolean | null>
  /**
   * Optional mtime-generation probe (0.3.18, E-71): milliseconds since epoch
   * of the path's mtime, or `null` when unknown (unsupported backend, missing
   * path, stat failure). Consumers use it as a cheap invalidation stamp for a
   * cached listing. Mirrors `EvolutionIoLike.mtime`.
   */
  mtime?(this: void, path: string): Promise<number | null>
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
