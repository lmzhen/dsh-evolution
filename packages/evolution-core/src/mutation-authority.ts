import { HomeFence } from './home-fence.ts'
import { LeaseStore } from './lease-store.ts'
import type { EvolutionIoLike } from './io.ts'
import type { MutationLockLease, MutationLockPort } from './mutation-unit.ts'
import { TargetLockSet } from './authority.ts'

export interface MutationAuthorityOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly leases?: LeaseStore
  readonly fence?: HomeFence
  readonly waitMs?: number
  readonly now?: () => number
}

/**
 * The family's write authority. It owns the one home fence and the per-run lease store.
 *
 * The lease is a per-run mutex for long-running review/approval work; foreground writes
 * have no run identity and are serialized by the fence. The former apply/transact/recover
 * facade claimed to gate every write on a lease but had no production caller, so it was
 * removed rather than kept as a false narrow waist.
 */
export class MutationAuthority {
  private readonly leases: LeaseStore
  private readonly fence: HomeFence

  /** Lease primitives for run/claim owners (review, approval). */
  get lease(): LeaseStore { return this.leases }

  /** The one home fence domain unit engines must reuse instead of taking tree-lock themselves. */
  get homeFence(): HomeFence { return this.fence }

  /** Adapter for MutationUnit call sites that accept a lock port. It is the fence, no more. */
  get mutationLock(): MutationLockPort {
    return {
      acquire: async () => {
        // A nested writer running inside an already-held home fence must reuse that
        // exclusion, not queue behind its own lease (merge undo/consolidate call public
        // mutators under one pass-level fence). A caller outside the fence still acquires.
        if (this.fence.holdsTree()) return { release: async () => {} }
        const lease = await this.fence.acquire()
        return { release: async () => { await lease.release() } }
      },
    }
  }

  constructor(options: MutationAuthorityOptions) {
    this.leases = options.leases ?? new LeaseStore({ io: options.io, home: options.home, ...(options.now === undefined ? {} : { now: options.now }) })
    this.fence = options.fence ?? new HomeFence({ io: options.io, home: options.home, ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }), ...(options.now === undefined ? {} : { now: options.now }) })
  }
}

/** Read the authority's fence adapter from a context; undefined means no authority is mounted. */
/** A keyed MutationLockPort over TargetLockSet; empty key sets are refused, not silently unlocked. */
export class TargetMutationLock implements MutationLockPort {
  constructor(private readonly locks: TargetLockSet) {}

  async acquire(targetKeys: readonly string[] = []): Promise<MutationLockLease> {
    if (targetKeys.length === 0) throw new Error('target mutation lock requires at least one target key')
    return await this.locks.acquireLease(targetKeys)
  }
}

/** Routes keyed writes to the target lock set and keyless writes to the root fence. */
export class HybridMutationLock implements MutationLockPort {
  constructor(
    private readonly keyed: TargetMutationLock,
    private readonly fallback: MutationLockPort,
  ) {}

  async acquire(targetKeys: readonly string[] = []): Promise<MutationLockLease> {
    return targetKeys.length === 0
      ? await this.fallback.acquire()
      : await this.keyed.acquire(targetKeys)
  }
}

export function mutationLockFrom(ctx: { get?(name: string): unknown } | undefined): MutationLockPort | undefined {
  if (ctx?.get === undefined) return undefined
  const authority = ctx.get('evolutionMutationAuthority') as { readonly mutationLock?: MutationLockPort } | undefined
  return authority?.mutationLock
}
