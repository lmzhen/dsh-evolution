/**
 * Cross-package contracts for the dsh-evolution family.
 *
 * This package is intentionally a library: it declares state and event shapes,
 * not a Cordis plugin. It must not import any evolution implementation package.
 *
 * @module @deepseek-ai/dsh-evolution-contract
 */

/** Branded collection name so durable keys cannot be confused with prose. */
export type EvolutionCollection = string & { readonly __evolutionCollection: unique symbol }

/** One platform service the family probes, with the feature that degrades without it. */
export interface PlatformServiceProbe {
  /** The service key as `ctx.get` spells it. */
  readonly service: string
  /** The family feature that degrades when the service is absent. */
  readonly feature: string
  /** Where the probe runs. */
  readonly side: 'host' | 'client'
}

/** One durable record store; the provider owns locking, CAS and medium selection. */
export interface EvolutionStateStore {
  /** Read one record; an absent record is undefined, a failed read throws. */
  read<T>(collection: EvolutionCollection, key: string): Promise<T | undefined>
  /** Atomically read-modify-write one record. The provider allocates its version. */
  transact<T>(collection: EvolutionCollection, key: string, fn: (current: T | undefined) => Promise<T>): Promise<T>
  /** List a collection; order is provider-defined but stable for a snapshot. */
  list<T>(collection: EvolutionCollection): Promise<T[]>
}

/** Capabilities a state provider may declare; absence means the caller must not assume it. */
export interface EvolutionStateCapabilities {
  /** True only when the provider guarantees serialization across processes. */
  readonly crossProcess: boolean
}

/** Versioned process-bus event payload; consumers must tolerate unknown versions. */
export interface EvolutionEvent<TPayload = unknown> {
  readonly name: string
  readonly version: 1
  readonly payload: TPayload
}

/** A lifecycle service implemented by a capability package. */
export interface EvolutionLifecycleService {
  /** Stable service name used in diagnostics. */
  readonly name: string
}

/** Optional platform capability: absent means the feature must declare its degradation. */
export interface EvolutionPlatformAccess {
  readonly state: EvolutionStateStore
  readonly capabilities: EvolutionStateCapabilities
}