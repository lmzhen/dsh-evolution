/**
 * Durable evolution state consumer.
 *
 * The service owns no medium and performs no IO. It resolves the mounted
 * provider from `ctx.evolutionStateStorage` (see evolution-state-json and
 * evolution-state-domain); `provider` config may pin one by name.
 * @module @deepseek-ai/dsh-evolution-state
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {
  CuratorStateRecord,
  EvolutionStateStorage,
  PendingRecord,
  PendingStatus,
  ReviewStateRecord,
} from '@deepseek-ai/dsh-evolution-state-storage'

export type {
  CuratorStateRecord,
  EvolutionStateStorage,
  PendingRecord,
  PendingStatus,
  ReviewStateRecord,
} from '@deepseek-ai/dsh-evolution-state-storage'
export {
  curatorStateSchema,
  EVOLUTION_DOMAIN,
  pendingSchema,
  reviewStateSchema,
} from '@deepseek-ai/dsh-evolution-state-domain'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionState: EvolutionState
  }
}

export interface Config {
  /** Pin a provider by name; empty = first registered provider. */
  provider?: string
}

export class EvolutionState extends Service {
  static inject = ['evolutionStateStorage']
  static Config: Schema<Config> = z.object({
    provider: z.string().default(''),
  })

  private readonly providerName: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionState')
    this.providerName = config.provider ?? ''
  }

  private storage(): EvolutionStateStorage {
    return this.ctx.evolutionStateStorage.provider(this.providerName || undefined)
  }

  loadReviewState(sessionId: string): Promise<ReviewStateRecord | null> {
    return this.storage().loadReviewState(sessionId)
  }

  saveReviewState(sessionId: string, record: ReviewStateRecord): Promise<void> {
    return this.storage().saveReviewState(sessionId, record)
  }

  loadCuratorState(): Promise<CuratorStateRecord | null> {
    return this.storage().loadCuratorState()
  }

  saveCuratorState(record: CuratorStateRecord): Promise<void> {
    return this.storage().saveCuratorState(record)
  }

  listPending(status: PendingStatus = 'pending'): Promise<PendingRecord[]> {
    return this.storage().listPending(status)
  }

  savePending(record: PendingRecord): Promise<void> {
    return this.storage().savePending(record)
  }

  deletePending(id: string): Promise<void> {
    return this.storage().deletePending(id)
  }

  tryResolvePending(id: string, status: 'approved' | 'rejected') {
    return this.storage().tryResolvePending(id, status)
  }

  claimPending(id: string, claimId: string) {
    return this.storage().claimPending(id, claimId)
  }

  releasePendingClaim(id: string, claimId: string) {
    return this.storage().releasePendingClaim(id, claimId)
  }
}

export default EvolutionState
