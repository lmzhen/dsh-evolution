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

  private provider(): MemoryProvider {
    const first = this.providers.values().next().value as MemoryProvider | undefined
    if (!first) throw new Error('memory: no provider registered')
    return first
  }

  read(target: MemoryTarget, signal?: AbortSignal): Promise<string[]> {
    return this.provider().read(target, signal)
  }

  applyBatch(target: MemoryTarget, operations: MemoryOperation[], signal?: AbortSignal): Promise<MemoryApplyResult> {
    return this.provider().applyBatch(target, operations, signal)
  }

  snapshot(signal?: AbortSignal): Promise<MemorySnapshot> {
    return this.provider().snapshot(signal)
  }

  renderContext(): Promise<string> {
    return this.provider().renderContext()
  }
}

export default MemoryRegistry
