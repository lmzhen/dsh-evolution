/**
 * The storage-domain implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { StorageDomainPort } from '@deepseek-ai/dsh-evolution-contract'

export type { StorageDomainPort } from '@deepseek-ai/dsh-evolution-contract'

interface StorageDomainServiceLike {
  open(spec: unknown): Promise<unknown>
}

/** Resolve the storage-domain port; undefined means the host has no provider. */
export function storageDomainPort(ctx: Context): StorageDomainPort | undefined {
  // platform-declaration anchor: storageDomain is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('storageDomain') as StorageDomainServiceLike | undefined
  if (service === undefined || typeof service.open !== 'function') return undefined
  return { open: <T = unknown>(spec: unknown) => service.open(spec) as Promise<T> }
}
