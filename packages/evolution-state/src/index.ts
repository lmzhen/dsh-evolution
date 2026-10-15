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
// 0.3.17 (E-11): the runtime re-export of the domain's zod schemas and
// EVOLUTION_DOMAIN is gone — it dragged evolution-state-domain (zod stack +
// dsh-storage-domain) into every deployment, even a pure-json one. The
// schemas stay in evolution-state-domain (their owner); consumers with a
// need import that package explicitly.

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
    // S-07: a PINNED provider name is verified at mount when any
    // provider is already registered — a config typo used to explode only at
    // the first state access, far away from the mistake (the registry's
    // precise "not registered" error now surfaces at start). With an empty
    // registry (mount order not settled yet) the check stays lazy by design.
    if (this.providerName && ctx.evolutionStateStorage.hasProviders()) {
      ctx.evolutionStateStorage.provider(this.providerName)
    }
    // G2b/2b.1: the UNPINNED case, refused at MOUNT. Two media with no pin means the effective one is
    // registration order — enabling the domain row in an overlay rebinds every state op to an empty medium
    // while all json state stays on disk, invisible (/evolution pending shows nothing, approve misses).
    // That used to be a warn-once at the first state access; the judgement is that it belongs here, because
    // after the first read the deployment has already operated on the wrong medium. The pin is THIS row
    // config, which is exactly why the registry cannot make this call itself — it never sees the pin.
    if (this.providerName === '' && ctx.evolutionStateStorage.providerNames().length > 1) {
      const names = ctx.evolutionStateStorage.providerNames().join(', ')
      throw new Error(
        'evolution-state: ' + String(ctx.evolutionStateStorage.providerNames().length) + ' state providers are registered (' + names
        + ') and this row pins none, so the effective medium would be registration order — a silent'
        + ' rebind that leaves existing state on disk and unreadable. Pin one: provider: <name>.',
      )
    }
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

  /** Atomic read-modify-write the curator-state record (S5.5): `task` returns
   * the next record; returning null keeps the current record unchanged (the
   * seam has no delete semantic). */
  transactCuratorState(task: (current: CuratorStateRecord | null) => CuratorStateRecord | null): Promise<void> {
    return this.storage().transactCuratorState(task)
  }

  listPending(status: PendingStatus = 'pending'): Promise<PendingRecord[]> {
    return this.storage().listPending(status)
  }

  savePending(record: PendingRecord): Promise<void> {
    return this.storage().savePending(record)
  }

  tryResolvePending(id: string, status: 'approved' | 'rejected', expectedClaimId?: string) {
    return this.storage().tryResolvePending(id, status, expectedClaimId)
  }

  claimPending(id: string, claimId: string) {
    return this.storage().claimPending(id, claimId)
  }

  releasePendingClaim(id: string, claimId: string) {
    return this.storage().releasePendingClaim(id, claimId)
  }
}

export default EvolutionState
