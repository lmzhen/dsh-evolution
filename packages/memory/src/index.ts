/**
 * Memory provider registry for the evolution family.
 * Service Definition role; concrete providers register here.
 * @module @deepseek-ai/dsh-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

export type MemoryTarget = 'memory' | 'user'

/** Service config (V27 G6.3): pin one provider by name. */
export interface Config {
  /** Provider to use; empty = first registered provider (row order). */
  provider?: string
}

export interface MemoryOperation {
  action: 'add' | 'replace' | 'remove'
  facts?: string | undefined
  content?: string | undefined
  old_text?: string | undefined
}

export interface MemoryApplyResult {
  ok: boolean
  message: string
  entries: string[]
  chars: number
  limit: number
}

/** Fired after ANY successful memory write (P2 fix): the snapshot refresh
 * moved to the registry sink so bypass paths (`/graph memory:`, background
 * review direct writes) also refresh the model-visible snapshot — not only
 * the foreground `memory` tool's write callback. */
export interface EvolutionMemoryAppliedEvent {
  target: MemoryTarget
  chars: number
  entries: number
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'evolution/memory-applied'(event: EvolutionMemoryAppliedEvent): void
  }
}

export interface MemorySnapshot {
  version: number
  sha256: string
  memory: string[]
  user: string[]
}

export interface MemoryProvider {
  readonly name: string
  read(target: MemoryTarget): Promise<string[]>
  applyBatch(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryApplyResult>
  snapshot(): Promise<MemorySnapshot>
  renderContext(): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryRegistry
  }
}

export class MemoryRegistry extends Service {
  /**
   * V27 G6.3: the same provider-pin contract the io/state seams use. Before
   * this, every delegation called `provider()` with no name, so with two
   * providers mounted the session-visible store was decided by ROW ORDER while
   * `memory-files.providerName` renamed a registration nothing selected — a
   * config no consumer read. Empty keeps the old behavior (first registered).
   */
  static Config: Schema<Config> = z.object({
    provider: z.string().default(''),
  })

  private readonly providers = new Map<string, MemoryProvider>()
  /** Dispose handles by provider name, so a stale handle cannot remove a newer registration. */
  private readonly disposals = new Map<string, () => void>()
  private readonly providerName: string
  private pinWarned = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'memory')
    this.providerName = config.provider ?? ''
    // A mount-time check like evolution-state's S-07 is not available here: the
    // registry and the provider-registration API are the SAME service, so a
    // provider can only register after this constructor and the registry is
    // always empty at mount. The pin is therefore verified at the two points
    // that exist — a warning when a differently-named provider registers (the
    // earliest visible signal), and the hard `provider(name)` throw on the first
    // read or write, which names the pin.
  }

  registerProvider(provider: MemoryProvider): () => void {
    if (this.providers.has(provider.name)) throw new Error(`memory provider "${provider.name}" already registered`)
    this.providers.set(provider.name, provider)
    if (this.providerName && provider.name !== this.providerName && !this.providers.has(this.providerName) && !this.pinWarned) {
      this.pinWarned = true
      this.ctx.logger.warn(`memory: config.provider="${this.providerName}" is not registered (mounted: "${provider.name}"); memory reads and writes fail until that provider mounts`)
    }
    const dispose = (): void => {
      // P3 (v16) parity with the io registry: a handle acts only while it is
      // still the CURRENT one for this name. An object-identity check cannot
      // tell generations apart, so after dispose → re-register(same object) a
      // stale handle used to delete the LIVE registration.
      if (this.disposals.get(provider.name) !== dispose) return
      this.providers.delete(provider.name)
      this.disposals.delete(provider.name)
    }
    this.disposals.set(provider.name, dispose)
    return dispose
  }

  /** Configured provider: the pinned name, or the first registered one. */
  private selected(): MemoryProvider {
    return this.provider(this.providerName || undefined)
  }

  /** 0.3.17 (E-73): named lookup like the io/state-storage registries; no
   * name = first registered (backward compatible). A named miss throws (F-333,
   * 0.3.23) instead of silently falling back to the first provider, so a wrong
   * name surfaces rather than writing to the wrong memory store. */
  provider(name?: string): MemoryProvider {
    if (name) {
      const byName = this.providers.get(name)
      if (!byName) throw new Error(`memory provider "${name}" is not registered`)
      return byName
    }
    const first = this.providers.values().next().value
    if (!first) throw new Error('memory: no provider registered')
    return first
  }

  read(target: MemoryTarget): Promise<string[]> {
    return this.selected().read(target)
  }

  async applyBatch(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryApplyResult> {
    const result = await this.selected().applyBatch(target, operations)
    // P2 fix: every successful write refreshes whatever listens — the snapshot
    // subscriber (tool-memory) re-renders the model-visible context. This is
    // the single write sink, so bypass paths are covered without per-path fixes.
    if (result.ok) this.ctx.emit('evolution/memory-applied', {
      target,
      chars: result.chars,
      entries: result.entries.length,
    })
    return result
  }

  /** V6-44 (0.3.37): test-support API — production consumers read the
   * model-visible context via `renderContext()`; snapshot() has no production
   * consumer (tests inspect the raw snapshot, kept by declaration).
   * @internal Exported for this package's own tests only. */
  snapshot(): Promise<MemorySnapshot> {
    return this.selected().snapshot()
  }

  renderContext(): Promise<string> {
    return this.selected().renderContext()
  }
}

export default MemoryRegistry
