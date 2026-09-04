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
  read(target: MemoryTarget, signal?: AbortSignal): Promise<string[]>
  applyBatch(target: MemoryTarget, operations: MemoryOperation[], signal?: AbortSignal): Promise<MemoryApplyResult>
  snapshot(signal?: AbortSignal): Promise<MemorySnapshot>
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
   * name = first registered (backward compatible). */
  provider(name?: string): MemoryProvider {
    const byName = name ? this.providers.get(name) : undefined
    if (byName) return byName
    const first = this.providers.values().next().value
    if (!first) throw new Error(`memory: no provider registered${name ? ` named "${name}"` : ''}`)
    return first
  }

  read(target: MemoryTarget, signal?: AbortSignal): Promise<string[]> {
    return this.provider().read(target, signal)
  }

  async applyBatch(target: MemoryTarget, operations: MemoryOperation[], signal?: AbortSignal): Promise<MemoryApplyResult> {
    const result = await this.provider().applyBatch(target, operations, signal)
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

  snapshot(signal?: AbortSignal): Promise<MemorySnapshot> {
    return this.provider().snapshot(signal)
  }

  renderContext(): Promise<string> {
    return this.provider().renderContext()
  }
}

export default MemoryRegistry
