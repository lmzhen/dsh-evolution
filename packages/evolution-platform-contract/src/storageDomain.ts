/**
 * The storage-domain half of the family's platform contract.
 */
export interface StorageDomainPort {
  open<T = unknown>(spec: unknown): Promise<T>
}
