/**
 * IO seam for evolution providers.
 * @module @deepseek-ai/dsh-evolution-io
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

/**
 * The family's IO seam. Everything except `transact` is single-sourced from
 * core `EvolutionIoLike` (0.3.23 G1.3, F-340): the seam no longer redeclares
 * `size`/`isSymlink`/`mtime` or their `this: void` and null-vs-undefined
 * contracts, so a drift between seam and core in those fields is impossible by
 * construction. `name` stays seam-only and is added here.
 *
 * `transact` stays intentionally narrower than core: seam backends (e.g.
 * `nodeEvolutionIo`) are uniformly async, so the task may return only a
 * `Promise`. Core additionally allows a sync return (0.3.16 S1.14 X-1); the
 * bidirectional-await-compatible consumers live in `transactIo` and the
 * evolution IO adapter.
 */
export type EvolutionIo = Omit<EvolutionIoLike, 'transact'> & {
  readonly name: string
  transact?(this: void, path: string, task: (current: string | null) => Promise<string | null>): Promise<void>
}

// Compile-time satisfiability (G1.3, F-340): the narrow seam must remain a
// valid core `EvolutionIoLike` so consumers typed against the wide core accept
// it. A drift that widens the seam or re-narrows a core field fails `tsc`.
const _seamSatisfiesCore: EvolutionIoLike = null as unknown as EvolutionIo
void _seamSatisfiesCore

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionIo: EvolutionIoRegistry
  }
}

export class EvolutionIoRegistry extends Service {
  private readonly providers = new Map<string, EvolutionIo>()
  /** Name of the provider that declared itself the default (P2-7, v14). */
  private defaultName: string | undefined
  /** P2-3 (v15): per-name dispose — the idempotent re-registration returns
   * the SAME function instance, so double-dispose is a single removal. */
  private readonly disposals = new Map<string, () => void>()

  constructor(ctx: Context) {
    super(ctx, 'evolutionIo')
  }

  /**
   * @param options.default - mark this provider as the one a nameless
   * `provider()` resolves. The first explicit default wins; without any
   * default the registry keeps its historical registration-order fallback.
   *
   * P2-3 (v15): re-registering the IDENTICAL provider object is idempotent —
   * it returns the original dispose and does not throw. This is what lets a
   * backend (io-node) re-apply (HMR / re-mounted row) without the silent
   * `hasProvider` early-return the v14 fix used, which had made the
   * fail-loud-below unreachable for a FOREIGN provider under the same name.
   * A different object under a registered name still throws.
   */
  registerProvider(provider: EvolutionIo, options: { default?: boolean } = {}): () => void {
    const idempotent = this.providers.get(provider.name) === provider
    if (!idempotent && this.providers.has(provider.name)) throw new Error(`evolution IO provider "${provider.name}" already registered`)
    // P3 (v16): the default declaration is handled BEFORE the idempotent
    // early-return — the first cut evaluated it only on the fresh path, so a
    // same-object re-registration that (now) declares default was silently
    // swallowed with no warn and no effect, inconsistent with the warn below.
    if (options.default === true) {
      if (this.defaultName !== undefined && this.defaultName !== provider.name) {
        this.ctx.logger.warn(`evolution IO provider "${provider.name}" declared itself the default, but "${this.defaultName}" already is — the first declaration wins`)
      }
      this.defaultName ??= provider.name
    }
    if (idempotent) {
      const existing = this.disposals.get(provider.name)
      if (existing !== undefined) return existing
    }
    const dispose = (): void => {
      // P3 (v16): GENERATION GUARD — a dispose handle acts only while it is
      // still the CURRENT one for this name. Without this, the
      // dispose→re-register(same singleton)→stale-handle sequence removed the
      // NEW registration (the object-identity check cannot tell generations
      // apart), leaving the registry empty for a live mount.
      if (this.disposals.get(provider.name) !== dispose) return
      this.providers.delete(provider.name)
      this.disposals.delete(provider.name)
      if (this.defaultName === provider.name) this.defaultName = undefined
    }
    this.providers.set(provider.name, provider)
    this.disposals.set(provider.name, dispose)
    return dispose
  }

  // P3-D1 (v15): the speculative `hasProviders()` from v14 was removed — zero
  // consumers (the lazy/boot-time probe it was written for reads the
  // state-storage registry's own `hasProviders`).
  // v20 (A-3): `hasProvider(name)` removed for the same reason — its only
  // callers were this package's own spec; a presence probe goes through
  // `provider(name)`, which fails loud on a missing name.

  provider(name?: string): EvolutionIo {
    if (name) {
      const provider = this.providers.get(name)
      if (provider) return provider
      throw new Error(`evolution IO provider "${name}" is not registered`)
    }
    // P2-7 (v14): prefer the provider that explicitly declared itself the
    // default; registration order remains the fallback for backends/tests that
    // do not declare one.
    const declared = this.defaultName === undefined ? undefined : this.providers.get(this.defaultName)
    const first = declared ?? this.providers.values().next().value
    // P3 (v15): actionable message — the empty-registry case is always a
    // missing mount, and every state seam error in the family names the row
    // to add.
    // P3 (v16): dual-scope guidance — published installs resolve @lmzhen, the
    // upstream overlay resolves @deepseek-ai (see the scope-occupancy note in
    // packages/README.md).
    if (!first) throw new Error('no evolution IO provider registered — mount evolution-io-node (@lmzhen/dsh-evolution-io-node published, @deepseek-ai/dsh-evolution-io-node in the dev overlay; ships with evolution-host/evolution-all) and retry')
    return first
  }
}

/**
 * Resolve the seam implementation for a consumer, preferring a backend the deployment mounted.
 *
 * Contract C2 (declared gaps) has no other shape: a consumer that can work on either medium asks for
 * its preference and the DEPLOYMENT decides which backends exist. The lookup is contained here because
 * the registry deliberately has no presence probe (v20 A-3 removed `hasProvider`; a presence probe goes
 * through `provider(name)`, which fails loud) — so this function is the ONE sanctioned place that turns
 * that failure into a fallback. A caller that needs a SPECIFIC backend must call `provider(name)` and
 * take the error.
 * @param registry - the seam registry (`ctx.evolutionIo`).
 * @param names - preferred provider names, most preferred first.
 * @returns the first registered preference, else the registry default.
 */
/**
 * @typeParam T - the seam implementation type the caller works with (`EvolutionIo` or the wider
 *   `EvolutionIoLike`), so the same helper serves every consumer shape.
 */
/**
 * G2a/2a.1: which medium actually served a consumer.
 *
 * `preferProvider` is the ONE sanctioned place that turns a not-registered name into a fallback (see its
 * JSDoc), so it is also the only place that can say what the fallback WAS. Recording here - and nowhere
 * else - is what keeps this from becoming a second resolution path.
 */
interface MediumObservation {
  readonly requested: readonly string[]
  /** The preference that served it, or undefined when the registry default did (unknowable from here). */
  readonly resolved: string | undefined
  readonly via: 'preference' | 'default'
}

const mediumObservations = new WeakMap<object, MediumObservation>()

/**
 * The read-only face of the marker: what served THIS registry, without resolving anything.
 * @param registry - the seam registry the caller already holds.
 * @returns `known` with the observation, or `unknown` when nothing resolved through this registry yet.
 */
export function describeMedium(registry: object):
  | { readonly state: 'known'; readonly requested: readonly string[]; readonly resolved: string | undefined; readonly via: string }
  | { readonly state: 'unknown' } {
  const observation = mediumObservations.get(registry)
  if (observation === undefined) return { state: 'unknown' }
  return { state: 'known', requested: observation.requested, resolved: observation.resolved, via: observation.via }
}

export function preferProvider<T>(
  registry: { provider(name?: string): T },
  names: readonly string[],
): T {
  for (const name of names) {
    try {
      const resolved = registry.provider(name)
      mediumObservations.set(registry, { requested: names, resolved: name, via: 'preference' })
      return resolved
    } catch {
      // Not registered: this name is a preference, not a requirement (see the JSDoc).
    }
  }
  const fallback = registry.provider()
  mediumObservations.set(registry, { requested: names, resolved: undefined, via: 'default' })
  return fallback
}

export default EvolutionIoRegistry
