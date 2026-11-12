/**
 * The family's one mutual-exclusion entry (W9-authority, invariant I1).
 *
 * Cross-process exclusion is the platform's writer lock (`withFileLock` from
 * `@deepseek-ai/dsh-atomic-write`): one lock per evolution home, so every scope shares it and two
 * scopes can never deadlock against each other. In-process callers queue FIFO through a promise
 * tail, so writers run in invocation order instead of racing for the platform lock.
 *
 * `scope` carries the nesting order only (`tree` outside, `state` inside — the merge shell writes
 * state while it holds the tree). Re-entrancy is explicit: `runNested` declares "this operation is
 * inside a held one", and the held context is tracked per authority instance so a second authority
 * for the same home is not mistaken for a re-entry. An undeclared re-entry throws instead of
 * waiting on the platform lock forever.
 *
 * A failed release never masks the body's outcome: an operation whose write already landed keeps
 * its result, and the failure is recorded for {@link HomeAuthority.releaseFailure} and `repair()`.
 * @module @deepseek-ai/dsh-evolution-core/authority
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock as platformFileLock } from '@deepseek-ai/dsh-atomic-write'
import { isProcessAlive } from './io.ts'

/** The lock handle a serialized body receives; `release` is a no-op when a scope owns it. */
export interface TreeLock {
  readonly token: string
  readonly epoch: number
  readonly path: string
  readonly acquiredAt: number
  release(): Promise<void>
  assertHeld(): Promise<boolean>
}

/** Who holds the home lock right now, for doctor rows; `undefined` means free or unreadable. */
export async function authorityHolder(home: string): Promise<{ readonly pid: number } | undefined> {
  try {
    const raw = await readFile(join(home, '.authority', 'home.lock'), 'utf8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? { pid } : undefined
  } catch {
    return undefined
  }
}

/** The write scopes the family serializes. `tree` is the outer scope, `state` the inner one. */
export type LockScope = 'tree' | 'state'

const ORDER: Readonly<Record<LockScope, number>> = { tree: 0, state: 1 }

const DEFAULT_WAIT_MS = 5_000

/** The scopes one authority holds in the current async call context. */
interface HeldContext {
  readonly owner: HomeAuthority
  readonly scopes: ReadonlySet<LockScope>
}

const CONTEXT = new AsyncLocalStorage<HeldContext>()

/** The platform lock timed out: another writer holds the home. */
export class AuthorityBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorityBusyError'
  }
}

/** A caller took a scope it already holds without declaring the nesting. */
export class AuthorityReentryError extends Error {
  constructor(scope: LockScope) {
    super('authority: "' + scope + '" would be re-entered; use runNested() inside a held operation')
    this.name = 'AuthorityReentryError'
  }
}

/** A caller took the outer scope while already holding the inner one. */
export class AuthorityOrderError extends Error {
  constructor(outer: LockScope, inner: LockScope) {
    super('lock order violation: scope "' + inner + '" is held but "' + outer + '" was requested; take tree before state')
    this.name = 'AuthorityOrderError'
  }
}

export interface HomeAuthorityOptions {
  /** Evolution home; the lock lives under `<home>/.authority/`. */
  readonly home: string
  /** How long to wait for the home lock. Default 5000 ms. */
  readonly waitMs?: number
  /** Test seam: the platform lock primitive. Production omits it. */
  readonly lock?: typeof platformFileLock
}

/** A release that failed after the body ran; never a reason to report the write as failed. */
export interface AuthorityReleaseFailure {
  readonly scope: LockScope
  readonly error: Error
}

/** A held home lock in lease form, for call sites that span several awaits. */
export interface AuthorityLease {
  assertHeld(): boolean
  /** Resolves after the home lock is released; a release failure is recorded, not thrown. */
  release(): Promise<void>
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** True when the platform lock refused within its wait budget. */
function isBusy(error: unknown): boolean {
  return error instanceof Error && /timed out waiting for the writer lock/.test(error.message)
}

/**
 * One home-wide writer authority. Every durable writer calls {@link HomeAuthority.runExclusive};
 * an operation that runs inside another held operation calls {@link HomeAuthority.runNested}.
 */
export class HomeAuthority {
  private readonly options: HomeAuthorityOptions
  private readonly held = new Map<LockScope, number>()
  private tail: Promise<void> = Promise.resolve()
  private pending: AuthorityReleaseFailure | undefined

  constructor(options: HomeAuthorityOptions) {
    this.options = options
  }

  /** The lock path the platform primitive writes its `<path>.lock` beside. */
  private get lockBase(): string {
    return join(this.options.home, '.authority', 'home')
  }

  /** The last release failure, if any; diagnostics only. */
  get releaseFailure(): AuthorityReleaseFailure | undefined {
    return this.pending
  }

  /** True while the current call context (or this instance) holds `scope`. */
  assertHeld(scope: LockScope): boolean {
    const context = CONTEXT.getStore()
    if (context?.owner === this) return context.scopes.has(scope)
    return (this.held.get(scope) ?? 0) > 0
  }

  /** True while this instance holds the home lock for any scope. */
  get holding(): boolean {
    return this.held.size > 0
  }

  /**
   * Run `body` inside a held operation: order-checked, no lock acquisition.
   * @param scope - the nested scope; must not be an outer scope of the held one.
   * @param body - the operation to run inline.
   * @returns the body's result.
   */
  async runNested<T>(scope: LockScope, body: () => Promise<T>): Promise<T> {
    const context = CONTEXT.getStore()
    if (context?.owner !== this) throw new AuthorityReentryError(scope)
    for (const outer of context.scopes) {
      if (ORDER[outer] > ORDER[scope]) throw new AuthorityOrderError(outer, scope)
    }
    const scopes = new Set(context.scopes)
    scopes.add(scope)
    return await CONTEXT.run({ owner: this, scopes }, body)
  }

  /**
   * Run `body` while holding the home lock, in invocation order among this instance's callers.
   * @param scope - the write scope; `tree` must be taken before `state`.
   * @param body - the operation to serialize.
   * @returns the body's result; a release failure is recorded, never thrown over it.
   */
  async runExclusive<T>(scope: LockScope, body: () => Promise<T>): Promise<T> {
    if (CONTEXT.getStore()?.owner === this) throw new AuthorityReentryError(scope)
    const previous = this.tail
    let releaseNext: () => void = () => {}
    this.tail = new Promise<void>(resolve => { releaseNext = resolve })
    await previous
    try {
      return await this.acquireAndRun(scope, body)
    } finally {
      releaseNext()
    }
  }

  private async acquireAndRun<T>(scope: LockScope, body: () => Promise<T>): Promise<T> {
    const lock = this.options.lock ?? platformFileLock
    await mkdir(dirname(this.lockBase), { recursive: true })
    let outcome: { readonly landed: true; readonly value: T } | { readonly landed: false; readonly error: unknown } | undefined
    let releaseError: unknown
    try {
      await lock(this.lockBase, async () => {
        this.held.set(scope, 1)
        try {
          outcome = { landed: true, value: await CONTEXT.run({ owner: this, scopes: new Set([scope]) }, body) }
        } catch (error) {
          outcome = { landed: false, error }
        } finally {
          this.held.delete(scope)
        }
      }, { waitMs: this.options.waitMs ?? DEFAULT_WAIT_MS })
    } catch (error) {
      releaseError = error
    }
    if (outcome === undefined) {
      const error = releaseError === undefined ? new Error('authority: the lock body never ran') : releaseError
      throw isBusy(error) ? new AuthorityBusyError(asError(error).message) : asError(error)
    }
    if (releaseError !== undefined) this.pending = { scope, error: asError(releaseError) }
    if (outcome.landed) return outcome.value
    throw outcome.error
  }

  /**
   * Hold the home lock until {@link AuthorityLease.release}. The platform lock is callback-scoped,
   * so the lease parks the callback on a gate while the caller works.
   * @param scope - the write scope.
   * @returns the lease.
   */
  async lease(scope: LockScope = 'tree'): Promise<AuthorityLease> {
    let enter: () => void = () => {}
    const entered = new Promise<void>(resolve => { enter = resolve })
    let leave: () => void = () => {}
    const gate = new Promise<void>(resolve => { leave = resolve })
    let failure: Error | undefined
    const running = this.runExclusive(scope, async () => {
      enter()
      await gate
    }).then(() => undefined, (error: unknown) => { failure = asError(error) })
    const raced = await Promise.race([
      entered.then(() => 'entered' as const),
      running.then(() => 'ended' as const),
    ])
    if (raced === 'ended') throw failure ?? new Error('authority: the lease ended before it was granted')
    return {
      assertHeld: () => this.assertHeld(scope),
      release: async () => {
        leave()
        await running
      },
    }
  }

  /**
   * Remove a lock file left behind by a failed release, when no live process holds it.
   * @returns `repaired` when a stale lock was removed, `noop` when nothing needed removing.
   */
  async repair(): Promise<'noop' | 'repaired'> {
    if (this.pending === undefined || this.held.size > 0) return 'noop'
    const lockPath = this.lockBase + '.lock'
    let holder: number | undefined
    try {
      const raw = await readFile(lockPath, 'utf8')
      const pid = Number.parseInt(raw.trim(), 10)
      holder = Number.isInteger(pid) && pid > 0 ? pid : undefined
    } catch {
      holder = undefined
    }
    if (holder !== undefined && holder !== process.pid && isProcessAlive(holder)) return 'noop'
    await rm(lockPath, { force: true })
    this.pending = undefined
    return 'repaired'
  }
}

/** Adapt an authority lease to the `TreeLock` handle older call sites use. */
export function leaseAsTreeLock(lease: AuthorityLease): TreeLock {
  return {
    token: 'authority',
    epoch: 0,
    path: 'authority:tree',
    acquiredAt: Date.now(),
    assertHeld: async () => lease.assertHeld(),
    release: async () => { await lease.release() },
  }
}
