/**
 * Legacy-medium write guard for DCR-85 activation.
 *
 * A process that booted in legacy mode must never keep writing legacy files after
 * another host (or a restart path) activates the MVCC medium: those writes would
 * be absent from the promoted head and disappear on the next start. This proxy
 * fails the first write after activation instead of silently losing it; reads
 * stay available so diagnostics can still see the old medium.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/activation-guard
 */
import type { EvolutionIoLike } from '../io.ts'
import { isStoreV2Active } from '../state/activation.ts'

export class StoreActivationPendingError extends Error {
  readonly code = 'store-activation-pending'

  constructor(message = 'the v2 medium was activated by another host; restart this host before writing') {
    super(message)
    this.name = 'StoreActivationPendingError'
  }
}

export interface ActivationGuardOptions {
  /** Optional path predicate; only guarded paths are blocked (default: all writes). */
  readonly path?: (path: string) => boolean
}

export function guardLegacyActivation(base: EvolutionIoLike, home: string, options: ActivationGuardOptions = {}): EvolutionIoLike {
  const activeAtBind = isStoreV2Active(home)
  const guarded = (path: string): boolean => options.path?.(path) ?? true
  const assert = (path: string): void => {
    if (guarded(path) && isStoreV2Active(home) !== activeAtBind) throw new StoreActivationPendingError()
  }
  return {
    get processScope() { return base.processScope },
    readText: path => base.readText(path),
    writeText: async (path, content) => { assert(path); await base.writeText(path, content) },
    get createTextIfAbsent() {
      const fn = base.createTextIfAbsent
      return fn === undefined ? undefined : async (path: string, content: string) => { assert(path); await fn(path, content) }
    },
    remove: async path => { assert(path); await base.remove(path) },
    list: path => base.list(path),
    exists: path => base.exists(path),
    rename: async (path, destination) => { assert(path); assert(destination); await base.rename(path, destination) },
    copy: async (path, destination) => { assert(path); assert(destination); await base.copy(path, destination) },
    size: path => base.size === undefined ? Promise.resolve(null) : base.size(path),
    transact: async (path, task) => {
      assert(path)
      if (base.transact === undefined) throw new Error('activation-guard: base IO has no transact')
      await base.transact(path, task)
    },
    isSymlink: path => base.isSymlink === undefined ? Promise.resolve(null) : base.isSymlink(path),
    mtime: path => base.mtime === undefined ? Promise.resolve(null) : base.mtime(path),
  }
}
