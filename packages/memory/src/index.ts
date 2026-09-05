/**
 * Memory provider registry for the evolution family.
 * Service Definition role; concrete providers register here.
 * @module @deepseek-ai/dsh-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'

export type MemoryTarget = 'memory' | 'user'

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
  private readonly providers = new Map<string, MemoryProvider>()

  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  registerProvider(provider: MemoryProvider): () => void {
    if (this.providers.has(provider.name)) throw new Error(`memory provider "${provider.name}" already registered`)
    this.providers.set(provider.name, provider)
    return () => {
      if (this.providers.get(provider.name) === provider) this.providers.delete(provider.name)
    }
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
    return this.provider().read(target)
  }

  async applyBatch(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryApplyResult> {
    const result = await this.provider().applyBatch(target, operations)
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

  snapshot(): Promise<MemorySnapshot> {
    return this.provider().snapshot()
  }

  renderContext(): Promise<string> {
    return this.provider().renderContext()
  }
}

export default MemoryRegistry
