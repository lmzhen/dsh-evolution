/**
 * Durable evolution state consumer.
 *
 * The service owns no medium and performs no IO. It resolves the mounted
 * provider from `ctx.evolutionStateStorage` (see evolution-state-json and
 * evolution-state-domain); `provider` config may pin one by name.
 * @module @deepseek-ai/dsh-evolution-core/state
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-evolution-platform/values'
import { evolutionHome } from '../state-store.ts'
import type Schema from '@deepseek-ai/schemastery'
import type {
  CuratorStateRecord,
  EvolutionStateStorage,
  PendingRecord,
  PendingStatus,
  ReviewStateRecord,
} from './storage.ts'
import { PROVIDER_DOMAIN, PROVIDER_STORE, STATE_MIGRATION_MARKER } from './storage.ts'

export * from './storage.ts'

export type {
  CuratorStateRecord,
  EvolutionStateStorage,
  PendingRecord,
  PendingStatus,
  ReviewStateRecord,
} from './storage.ts'
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
  /** Pin a provider by name; `auto` picks store after the migration marker, else domain. */
  provider?: string
  /** Evolution home override (tests/migration); defaults to `evolutionHome()`. */
  home?: string
}

export class EvolutionState extends Service {
  static inject = ['evolutionStateStorage']
  static Config: Schema<Config> = z.object({
    provider: z.string().default(''),
    home: z.string().default(''),
  })

  private readonly providerName: string
  private readonly home: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionState')
    this.providerName = config.provider ?? ''
    this.home = config.home !== undefined && config.home !== '' ? config.home : evolutionHome()
    // S-07: a PINNED provider name is verified at mount when any
    // provider is already registered — a config typo used to explode only at
    // the first state access, far away from the mistake (the registry's
    // precise "not registered" error now surfaces at start). With an empty
    // registry (mount order not settled yet) the check stays lazy by design.
    if (this.providerName !== '' && this.providerName !== 'auto' && ctx.evolutionStateStorage.hasProviders()) {
      ctx.evolutionStateStorage.provider(this.providerName)
    }
    // G2b/2b.1: the UNPINNED case, refused at MOUNT. Two media with no pin means the effective one is
    // registration order — enabling the domain row in an overlay rebinds every state op to an empty medium
    // while all json state stays on disk, invisible (/evolution pending shows nothing, approve misses).
    // That used to be a warn-once at the first state access; the judgement is that it belongs here, because
    // after the first read the deployment has already operated on the wrong medium. The pin is THIS row
    // config, which is exactly why the registry cannot make this call itself — it never sees the pin.
    this.assertProviderChoice()
  }

  /** P2-5: the multi-provider refusal is not a mount-time-only check. A provider
   * registered after this row mounted used to make registration order the effective
   * medium with no pin — exactly the silent rebind the mount check exists to stop. */
  private assertProviderChoice(): void {
    if (this.providerName === 'auto') {
      const names = this.ctx.evolutionStateStorage.providerNames()
      if (existsSync(join(this.home, 'state', STATE_MIGRATION_MARKER))) {
        if (!names.includes(PROVIDER_STORE)) throw new Error('evolution-state: the migration marker exists but no "' + PROVIDER_STORE + '" provider is registered')
        const storePath = join(this.home, 'state', 'store.json')
        if (!existsSync(storePath) || statSync(storePath).size === 0) {
          throw new Error('evolution-state: the migration marker exists but the store is missing/empty: ' + storePath)
        }
      }
      return
    }
    if (this.providerName !== '') return
    const names = this.ctx.evolutionStateStorage.providerNames()
    if (names.length <= 1) return
    throw new Error(
      'evolution-state: ' + String(names.length) + ' state providers are registered (' + names.join(', ')
      + ') and this row pins none, so the effective medium would be registration order — a silent'
      + ' rebind that leaves existing state on disk and unreadable. Pin one: provider: <name>.',
    )
  }

  /** `auto` is the migration switch: the marker is the explicit one-way signal. */
  private autoProviderName(): string {
    const names = this.ctx.evolutionStateStorage.providerNames()
    const marker = join(this.home, 'state', STATE_MIGRATION_MARKER)
    if (existsSync(marker)) {
      const storePath = join(this.home, 'state', 'store.json')
      // A marker without a non-empty store is a half-migration; failing loud is
      // safer than silently serving an empty state authority.
      if (!existsSync(storePath) || statSync(storePath).size === 0) {
        throw new Error('evolution-state: the migration marker exists but the store is missing/empty: ' + storePath + ' (restore the store or remove the marker to keep using domain)')
      }
      return PROVIDER_STORE
    }
    if (names.includes(PROVIDER_DOMAIN)) return PROVIDER_DOMAIN
    throw new Error('evolution-state: auto has no migration marker and no "' + PROVIDER_DOMAIN + '" provider; refusing to guess a state authority')
  }

  /** Validate synchronously (legacy callers rely on a throw, not a rejected promise). */
  private assertResolvable(): void {
    this.assertProviderChoice()
    if (this.providerName !== '' && this.providerName !== 'auto') {
      // Throws synchronously for an unknown/absent pinned provider; the mount-time
      // check stays lazy only while the registry is empty.
      this.ctx.evolutionStateStorage.provider(this.providerName)
    }
  }

  /** Validate, then serialize against migration across processes. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    this.assertResolvable()
    return this.withStateLock(task)
  }

  /** Serialize state operations against the migration command across processes. */
  private async withStateLock<T>(task: () => Promise<T>): Promise<T> {
    await mkdir(this.home, { recursive: true })
    return withFileLock(join(this.home, 'state.lock'), task)
  }

  private storage(): EvolutionStateStorage {
    this.assertProviderChoice()
    const name = this.providerName === 'auto' ? this.autoProviderName() : this.providerName
    return this.ctx.evolutionStateStorage.provider(name || undefined)
  }

  /** A2: refresh the mounted provider before a decision reads pending state. */
  reload(): Promise<void> {
    return this.run(async () => this.storage().reload?.() ?? Promise.resolve())
  }

  loadReviewState(sessionId: string): Promise<ReviewStateRecord | null> {
    return this.run(async () => this.storage().loadReviewState(sessionId))
  }

  saveReviewState(sessionId: string, record: ReviewStateRecord): Promise<void> {
    return this.run(async () => this.storage().saveReviewState(sessionId, record))
  }

  loadCuratorState(): Promise<CuratorStateRecord | null> {
    return this.run(async () => this.storage().loadCuratorState())
  }

  saveCuratorState(record: CuratorStateRecord): Promise<void> {
    return this.run(async () => this.storage().saveCuratorState(record))
  }

  /** Atomic read-modify-write the curator-state record (S5.5): `task` returns
   * the next record; returning null keeps the current record unchanged (the
   * seam has no delete semantic). */
  transactCuratorState(task: (current: CuratorStateRecord | null) => CuratorStateRecord | null): Promise<void> {
    return this.run(async () => this.storage().transactCuratorState(task))
  }

  listPending(status: PendingStatus = 'pending'): Promise<PendingRecord[]> {
    return this.run(async () => this.storage().listPending(status))
  }

  savePending(record: PendingRecord): Promise<void> {
    return this.run(async () => this.storage().savePending(record))
  }

  tryResolvePending(id: string, status: 'approved' | 'rejected', expectedClaimId?: string) {
    return this.run(async () => this.storage().tryResolvePending(id, status, expectedClaimId))
  }

  claimPending(id: string, claimId: string) {
    return this.run(async () => this.storage().claimPending(id, claimId))
  }

  releasePendingClaim(id: string, claimId: string) {
    return this.run(async () => this.storage().releasePendingClaim(id, claimId))
  }
}

export default EvolutionState
