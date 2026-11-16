/**
 * The storage-domain half of the family's host platform boundary.
 *
 * The domain schema stays in evolution-state; this port only forwards its open
 * call so the platform package imports no state types.
 */
import type { Context } from '@deepseek-ai/cordis'

export interface StorageDomainPort {
  open<T = unknown>(spec: unknown): Promise<T>
}

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
