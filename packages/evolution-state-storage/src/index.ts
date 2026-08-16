/**
 * Provider seam for durable evolution state.
 *
 * The state CONSUMER (`@deepseek-ai/dsh-evolution-state`) never touches a
 * medium. Providers register here: `domain` (storage-domain KV) and `json`
 * (IO-seam files) are the two shipped providers.
 * @module @deepseek-ai/dsh-evolution-state-storage
 */

import { Context, Service } from '@deepseek-ai/cordis'

export type PendingKind = 'memory' | 'skill' | 'skill_batch'
export type PendingStatus = 'pending' | 'approved' | 'rejected'

export interface ReviewStateRecord {
  turnsSinceMemory: number
  turnsSinceSkill: number
  lastTurn: number
}

export interface CuratorStateRecord {
  lastRunAt: number
  runCount: number
  lastSummary: string
  paused: boolean
}

export interface PendingRecord {
  id: string
  kind: PendingKind
  summary: string
  args: unknown
  createdAt: string
  status: PendingStatus
  resolvedAt?: string | undefined
}

export interface PendingResolution {
  record: PendingRecord | null
  applied: boolean
}

export interface EvolutionStateStorage {
  readonly name: string
  loadReviewState(sessionId: string): Promise<ReviewStateRecord | null>
  saveReviewState(sessionId: string, record: ReviewStateRecord): Promise<void>
  loadCuratorState(): Promise<CuratorStateRecord | null>
  saveCuratorState(record: CuratorStateRecord): Promise<void>
  listPending(status?: PendingStatus): Promise<PendingRecord[]>
  savePending(record: PendingRecord): Promise<void>
  deletePending(id: string): Promise<void>
  /** Atomically transition a pending record exactly once. */
  tryResolvePending(id: string, status: Exclude<PendingStatus, 'pending'>): Promise<PendingResolution>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionStateStorage: EvolutionStateStorageRegistry
  }
}

export class EvolutionStateStorageRegistry extends Service {
  private readonly providers = new Map<string, EvolutionStateStorage>()

  constructor(ctx: Context) {
    super(ctx, 'evolutionStateStorage')
  }

  registerProvider(provider: EvolutionStateStorage): () => void {
    if (this.providers.has(provider.name)) throw new Error(`evolution state storage provider "${provider.name}" already registered`)
    this.providers.set(provider.name, provider)
    return () => {
      if (this.providers.get(provider.name) === provider) this.providers.delete(provider.name)
    }
  }

  provider(name?: string): EvolutionStateStorage {
    if (name) {
      const provider = this.providers.get(name)
      if (provider) return provider
      throw new Error(`evolution state storage provider "${name}" is not registered`)
    }
    const first = this.providers.values().next().value as EvolutionStateStorage | undefined
    if (!first) throw new Error('no evolution state storage provider registered; mount @deepseek-ai/dsh-evolution-state-json or @deepseek-ai/dsh-evolution-state-domain')
    return first
  }
}

export default EvolutionStateStorageRegistry
