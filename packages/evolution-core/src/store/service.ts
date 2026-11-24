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
import type { StoreCommitResult, StoreDomainId, StoreDomainValues, StoreSnapshot, StoreTreeRef } from './types.ts'

export interface StoreQueryResult {
  readonly commandId: string
  readonly snapshot: StoreSnapshot
}

export interface StoreCommandRequest {
  readonly commandId: string
  readonly domains: readonly StoreDomainId[]
  readonly source?: Parameters<StoreKernel['mutate']>[0]['source'] | undefined
  readonly expectedCommit?: string | undefined
  readonly change: (current: StoreSnapshot) => StoreDomainValues | Promise<StoreDomainValues>
  readonly tree?: StoreTreeRef | null | undefined
}

/** One store service per evolution home; every surface calls the same instance. */
export class StoreService {
  constructor(private readonly kernel: StoreKernel) {}

  /** Read one surface's declared domains from one commit, without a writer lock. */
  async query(commandId: string, domains?: readonly StoreDomainId[]): Promise<StoreQueryResult> {
    const command = requireStoreSurfaceCommand(commandId)
    const declared = new Set<StoreDomainId>([...command.reads, ...command.writes])
    const requested = domains ?? [...declared]
    for (const domain of requested) {
      if (!declared.has(domain)) throw new Error(`store surface ${commandId} may not read domain ${domain}`)
    }
    return { commandId, snapshot: await this.kernel.query(requested) }
  }

  /** Publish one surface mutation; the service rejects undeclared write domains. */
  async command(request: StoreCommandRequest): Promise<StoreCommitResult> {
    const command = requireStoreSurfaceCommand(request.commandId)
    const declared = new Set<StoreDomainId>(command.writes)
    for (const domain of request.domains) {
      if (!declared.has(domain)) throw new Error(`store surface ${request.commandId} may not write domain ${domain}`)
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
export function createStoreService(kernel: StoreKernel): StoreService {
  return new StoreService(kernel)
}
