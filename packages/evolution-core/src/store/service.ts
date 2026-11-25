/**
 * The one query/command service over the home MVCC store.
 *
 * Every registered DCR-85 surface goes through this service: a caller names the
 * surface command id, and the service checks that the domains it asks for are
 * declared by that command. The store kernel keeps the lock-free read and the
 * single writer path; this layer only enforces the surface closure.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/service
 */

import { requireStoreSurfaceCommand } from './surface.ts'
import { StoreKernel } from './store-kernel.ts'
import { StoreError } from './types.ts'
import type { StoreCommitResult, StoreDomainId, StoreDomainValues, StoreSnapshot, StoreTreeRef } from './types.ts'

export interface StoreQueryResult {
  readonly commandId: string
  readonly snapshot: StoreSnapshot
  /** Activation generation this service was created for. */
  readonly generation: number
}

export interface StoreCommandRequest {
  readonly commandId: string
  readonly domains: readonly StoreDomainId[]
  readonly source?: Parameters<StoreKernel['mutate']>[0]['source'] | undefined
  readonly expectedCommit?: string | undefined
  /** Optional activation guard: a stale generation refuses the write. */
  readonly expectedGeneration?: number | undefined
  readonly change: (current: StoreSnapshot) => StoreDomainValues | Promise<StoreDomainValues>
  readonly tree?: StoreTreeRef | null | undefined
}

/** Typed domain representation shared by internal providers (R10.5 codec table). */
export interface DomainCodec<T> {
  readonly decode: (value: unknown | undefined) => T
  readonly encode: (value: T) => unknown
}

export interface StoreDomainRead<T> {
  readonly commitId: string
  readonly generation: number
  readonly tree: StoreTreeRef | null
  readonly value: T
}

/** One store service per evolution home; every surface calls the same instance. */
export class StoreService {
  constructor(private readonly kernel: StoreKernel, readonly generation = 0) {}

  /**
   * Internal typed read (no surface closure): the caller owns the domain codec.
   * External/model surfaces use {@link query} so their declared reads are checked.
   */
  async read<T>(domain: StoreDomainId, codec: DomainCodec<T>): Promise<StoreDomainRead<T>> {
    const snapshot = await this.kernel.query([domain])
    return { commitId: snapshot.commitId, generation: this.generation, tree: snapshot.tree, value: codec.decode(snapshot.domains[domain]) }
  }

  /**
   * Internal typed read-modify-write in one commit. External surfaces use
   * {@link command}; this path exists for providers whose write is not a user
   * command (source defaults to `system`).
   */
  async transact<T>(
    domain: StoreDomainId,
    codec: DomainCodec<T>,
    change: (current: T) => T | Promise<T>,
    options: { readonly source?: StoreCommandRequest['source']; readonly expectedCommit?: string } = {},
  ): Promise<StoreCommitResult> {
    return await this.kernel.mutate({
      domains: [domain],
      source: options.source ?? 'system',
      ...(options.expectedCommit === undefined ? {} : { expectedHead: options.expectedCommit }),
      change: async (current) => {
        const next = await change(codec.decode(current.domains[domain]))
        return { [domain]: codec.encode(next) }
      },
    })
  }

  /** Read one surface's declared domains from one commit, without a writer lock. */
  async query(commandId: string, domains?: readonly StoreDomainId[]): Promise<StoreQueryResult> {
    const command = requireStoreSurfaceCommand(commandId)
    const declared = new Set<StoreDomainId>([...command.reads, ...command.writes])
    const requested = domains ?? [...declared]
    for (const domain of requested) {
      if (!declared.has(domain)) throw new Error(`store surface ${commandId} may not read domain ${domain}`)
    }
    return { commandId, snapshot: await this.kernel.query(requested), generation: this.generation }
  }

  /** Publish one surface mutation; the service rejects undeclared write domains. */
  async command(request: StoreCommandRequest): Promise<StoreCommitResult> {
    const command = requireStoreSurfaceCommand(request.commandId)
    if (command.expectsCommit && request.expectedCommit === undefined) {
      throw new StoreError('store-expected-commit-required',
        `store surface ${request.commandId} requires the observed commit; re-read before writing`)
    }
    const declared = new Set<StoreDomainId>(command.writes)
    for (const domain of request.domains) {
      if (!declared.has(domain)) throw new Error(`store surface ${request.commandId} may not write domain ${domain}`)
    }
    if (request.expectedGeneration !== undefined && request.expectedGeneration !== this.generation) {
      throw new StoreError('store-generation-mismatch',
        `store activation changed: expected generation ${String(request.expectedGeneration)}, current ${String(this.generation)}`)
    }
    return await this.kernel.mutate({
      domains: request.domains,
      source: request.source ?? 'command',
      ...(request.expectedCommit === undefined ? {} : { expectedHead: request.expectedCommit }),
      change: request.change,
      ...(request.tree === undefined ? {} : { tree: request.tree }),
    })
  }
}

/** Build the surface service around one kernel instance. */
export function createStoreService(kernel: StoreKernel, generation = 0): StoreService {
  return new StoreService(kernel, generation)
}

/** A service value, or a use-time resolver (late provide / HMR replacement). */
export type StoreServiceSource = StoreService | (() => StoreService | undefined) | undefined

/** Resolve an optional service at USE time; a constructor-captured value would freeze HMR. */
export function resolveStoreService(source: StoreServiceSource): StoreService | undefined {
  return typeof source === 'function' ? source() : source
}

/** The one family-wide live resolver for `ctx.get('evolutionStore')`. */
export function liveStoreService(ctx: { get?(name: string): unknown } | undefined): () => StoreService | undefined {
  return () => ctx?.get?.('evolutionStore') as StoreService | undefined
}
