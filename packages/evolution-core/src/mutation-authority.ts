import { randomUUID } from 'node:crypto'
import type { MutationOwner } from '@deepseek-ai/dsh-evolution-contract'
import { HomeFence, HomeFenceError } from './home-fence.ts'
import { LeaseStore, type LeaseToken } from './lease-store.ts'
import type { EvolutionIoLike } from './io.ts'
import {
  MutationUnit,
  type MutationLimits,
  type MutationLockPort,
  type MutationResult,
  type MutationSnapshotPort,
  type MutationUnitContext,
  type MutationUnitOptions,
  type MutationRequest,
} from './mutation-unit.ts'

export interface MutationAuthorityContext {
  readonly owner: MutationOwner
  readonly runId: string
  readonly lease: LeaseToken
  readonly signal?: AbortSignal
}

export type MutationAuthorityApplyOptions = Omit<MutationUnitOptions, 'io' | 'lock' | 'serial' | 'context'>

export interface RecoveryReport {
  readonly recovered: readonly MutationResult[]
  readonly blocked: readonly { readonly unitId: string; readonly runId?: string }[]
}

export class MutationAuthorityError extends Error {
  readonly code: 'lease-missing' | 'lease-mismatch' | 'fence-busy' | 'fence-io' | 'transact-failed'
  constructor(code: MutationAuthorityError['code'], message: string) {
    super(message)
    this.name = 'MutationAuthorityError'
    this.code = code
  }
}

export interface MutationAuthorityOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly leases?: LeaseStore
  readonly fence?: HomeFence
  readonly waitMs?: number
  readonly now?: () => number
}

const passiveLock: MutationLockPort = {
  async acquire() {
    return { async release() {} }
  },
}

const identitySerial = async <T>(task: () => Promise<T>): Promise<T> => await task()

/**
 * Plugin-side write authority: one home fence + one active lease before any
 * multi-file unit or single-file transaction. Domain code never takes a second
 * lock; MutationUnit remains the only multi-file transaction engine.
 */
export class MutationAuthority {
  private readonly io: EvolutionIoLike
  private readonly leases: LeaseStore
  private readonly fence: HomeFence

  constructor(options: MutationAuthorityOptions) {
    this.io = options.io
    this.leases = options.leases ?? new LeaseStore({ io: options.io, home: options.home, ...(options.now === undefined ? {} : { now: options.now }) })
    this.fence = options.fence ?? new HomeFence({ io: options.io, home: options.home, ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }), ...(options.now === undefined ? {} : { now: options.now }) })
  }

  private async assertLease(context: MutationAuthorityContext): Promise<void> {
    const current = await this.leases.active(context.runId)
    if (current === null) throw new MutationAuthorityError('lease-missing', 'mutation lease is not active for ' + context.runId)
    if (current.id !== context.lease.id || current.epoch !== context.lease.epoch || current.owner !== context.owner) {
      throw new MutationAuthorityError('lease-mismatch', 'mutation lease does not own ' + context.runId)
    }
  }

  async apply(request: MutationRequest, context: MutationAuthorityContext, options: MutationAuthorityApplyOptions): Promise<MutationResult> {
    if (context.signal?.aborted === true) throw new MutationAuthorityError('transact-failed', 'mutation aborted before apply')
    await this.assertLease(context)
    try {
      return await this.fence.run(async () => {
        await this.assertLease(context)
        const unitContext: MutationUnitContext = { owner: context.owner, runId: context.runId, leaseId: context.lease.id }
        const unit = new MutationUnit({ io: this.io, lock: passiveLock, serial: identitySerial, context: unitContext, ...options })
        return await unit.apply(request)
      })
    } catch (error) {
      if (error instanceof HomeFenceError) {
        throw new MutationAuthorityError(error.reason === 'busy' ? 'fence-busy' : 'fence-io', error.message)
      }
      throw error
    }
  }

  async transact(path: string, task: (current: string | null) => Promise<string | null> | string | null, context: MutationAuthorityContext): Promise<void> {
    await this.assertLease(context)
    try {
      return await this.fence.run(async () => {
        await this.assertLease(context)
        const body = async (current: string | null): Promise<string | null> => await task(current)
        if (this.io.transact !== undefined) await this.io.transact(path, body)
        else {
          const current = await this.io.readText(path)
          const next = await body(current)
          if (next === null) await this.io.remove(path)
          else if (next !== current) await this.io.writeText(path, next)
        }
        return
      })
    } catch (error) {
      if (error instanceof HomeFenceError) {
        throw new MutationAuthorityError(error.reason === 'busy' ? 'fence-busy' : 'fence-io', error.message)
      }
      throw error
    }
  }

  /** Control-plane single-file write: short-lived system lease + HomeFence, no unit snapshot. */
  async transactSystem(path: string, task: (current: string | null) => Promise<string | null> | string | null): Promise<void> {
    const runId = 'system-' + randomUUID()
    const acquired = await this.leases.acquire('foreground', runId, 15_000)
    if (!acquired.ok) throw new MutationAuthorityError('lease-missing', 'could not acquire system lease for ' + path)
    try {
      await this.transact(path, task, { owner: 'foreground', runId, lease: acquired.token })
    } finally {
      await this.leases.release(acquired.token)
    }
  }

  async recover(options: { readonly snapshots: MutationSnapshotPort; readonly limits: MutationLimits }): Promise<RecoveryReport> {
    return await this.fence.run(async () => {
      const unit = new MutationUnit({ io: this.io, snapshots: options.snapshots, limits: options.limits, lock: passiveLock, serial: identitySerial })
    const prepared = await options.snapshots.listPrepared?.() ?? []
    const recovered: MutationResult[] = []
    const blocked: { unitId: string; runId?: string }[] = []
    for (const snapshot of prepared) {
      if (snapshot.runId === undefined) {
        blocked.push({ unitId: snapshot.unitId })
        continue
      }
      const lease = await this.leases.active(snapshot.runId)
      if (lease !== null) {
        blocked.push({ unitId: snapshot.unitId, runId: snapshot.runId })
        continue
      }
      recovered.push(await unit.recover(snapshot.unitId))
    }
      return { recovered, blocked }
    })
  }
}
