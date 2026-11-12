/**
 * Lease adapter over the one HomeAuthority (W9-authority).
 *
 * The fence owns no lock protocol of its own any more: cross-process exclusion is the platform
 * writer lock inside {@link HomeAuthority}, and this class only keeps the family's historical
 * `run`/`acquire` API so call sites (mutation units, the commit shell) keep working. A failed
 * release is recorded on the authority instead of poisoning every later writer.
 * @module @deepseek-ai/dsh-evolution-core/home-fence
 */
import { AuthorityBusyError, HomeAuthority, type AuthorityReleaseFailure, type TreeLock } from './authority.ts'

export interface HomeFenceOptions {
  /** Evolution home; the authority's lock lives under `<home>/.authority/`. */
  readonly home: string
  /** How long to wait for the home lock. Default 5000 ms. */
  readonly waitMs?: number
  /** Retained for call-site compatibility; the authority owns exclusion, not the IO seam. */
  readonly io?: unknown
  readonly now?: () => number
  /** Test seam: share one authority (and its reentrancy state) across fences. */
  readonly authority?: HomeAuthority
}

export interface HomeFenceLease {
  readonly lock: TreeLock
  release(): Promise<void>
}

export class HomeFenceError extends Error {
  readonly reason: 'busy' | 'io'

  constructor(reason: 'busy' | 'io', message: string) {
    super(message)
    this.name = 'HomeFenceError'
    this.reason = reason
  }
}

/** A lock view for bodies that only need `assertHeld`; the authority releases on scope exit. */
function lockView(authority: HomeAuthority): TreeLock {
  return {
    token: 'authority',
    epoch: 0,
    path: 'authority:tree',
    acquiredAt: Date.now(),
    assertHeld: async () => authority.assertHeld('tree'),
    release: async () => {},
  }
}

function classify(error: unknown): unknown {
  return error instanceof AuthorityBusyError ? new HomeFenceError('busy', error.message) : error
}

/** The family's home-level writer queue, backed by the one authority. */
export class HomeFence {
  private readonly authority: HomeAuthority

  constructor(options: HomeFenceOptions) {
    this.authority = options.authority ?? new HomeAuthority({
      home: options.home,
      ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
    })
  }

  /** The last release failure, if any; diagnostics only. */
  get releaseFailure(): AuthorityReleaseFailure | undefined {
    return this.authority.releaseFailure
  }


  async run<T>(body: (lock: TreeLock) => Promise<T>): Promise<T> {
    try {
      return await this.authority.runExclusive('tree', async () => await body(lockView(this.authority)))
    } catch (error) {
      throw classify(error)
    }
  }

  async acquire(): Promise<HomeFenceLease> {
    try {
      const lease = await this.authority.lease('tree')
      return {
        lock: lockView(this.authority),
        release: async () => { await lease.release() },
      }
    } catch (error) {
      throw classify(error)
    }
  }
}
