/**
 * IO seam for evolution providers.
 * @module @deepseek-ai/dsh-evolution-io
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

/**
 * The family's IO seam. Everything except `transact` is single-sourced from
 * core `EvolutionIoLike` (0.3.23 G1.3, F-340): the seam no longer redeclares
 * `size`/`isSymlink`/`mtime` or their `this: void` and null-vs-undefined
 * contracts, so a drift between seam and core in those fields is impossible by
 * construction. `name` stays seam-only and is added here.
 *
 * `transact` stays intentionally narrower than core: seam backends (e.g.
 * `nodeEvolutionIo`) are uniformly async, so the task may return only a
 * `Promise`. Core additionally allows a sync return (0.3.16 S1.14 X-1); the
 * bidirectional-await-compatible consumers live in `transactIo` and the
 * evolution IO adapter.
 */
export type EvolutionIo = Omit<EvolutionIoLike, 'transact'> & {
  readonly name: string
  transact?(this: void, path: string, task: (current: string | null) => Promise<string | null>): Promise<void>
}

// Compile-time satisfiability (G1.3, F-340): the narrow seam must remain a
// valid core `EvolutionIoLike` so consumers typed against the wide core accept
// it. A drift that widens the seam or re-narrows a core field fails `tsc`.
const _seamSatisfiesCore: EvolutionIoLike = null as unknown as EvolutionIo
void _seamSatisfiesCore

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
