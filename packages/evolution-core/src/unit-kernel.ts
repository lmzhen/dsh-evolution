import { isCommittedWarning, TransactionNotInvokedError, transactIo, type EvolutionIoLike } from './io.ts'

/** The four persistent writer kinds the family permits. */

/** A unit whose targets were read and verified by prepare(); it carries no bytes. */
export interface PreparedUnit {
  readonly targets: readonly UnitTarget[]
}

/** One planned write: expected is the baseline read before the plan, next is the new bytes. */
export interface UnitTarget {
  readonly path: string
  readonly expected: string | null
  readonly next: string | null
  readonly skill?: string | undefined
}

/** A structured failure; conflict always means the target changed before/inside the write. */
export interface UnitKernelError {
  readonly code: 'cas-conflict' | 'write-failed' | 'compensation-blocked' | 'transact-not-invoked'
  readonly message: string
  readonly target: string
}

/** Outcome of one write or one multi-target commit. */
export interface UnitKernelResult {
  readonly ok: boolean
  readonly changed: readonly string[]
  readonly errors: readonly UnitKernelError[]
  readonly warnings?: readonly string[] | undefined
}

export interface UnitKernelOptions {
  readonly io: EvolutionIoLike
  readonly transact?: typeof transactIo | undefined
  readonly now?: (() => number) | undefined
}

export interface UnitWriteOneOptions {
  /** false is the create-under-root-lock retry seam: a mismatch defers instead of failing. */
  readonly guardBaseline?: boolean | undefined
}

/**
 * The family's single write primitive: compare the baseline INSIDE the write
 * transaction, never overwrite a concurrent value, and compensate only this
 * unit's own writes. Business state machines stay in their domain owners.
 */
export class UnitKernel {
  private readonly io: EvolutionIoLike
  private readonly transact: UnitKernelOptions['transact']
  private readonly now: () => number

  constructor(options: UnitKernelOptions) {
    this.io = options.io
    this.transact = options.transact
    this.now = options.now ?? Date.now
  }

  /** @returns the current time source; exposed for adapters that stamp evidence. */
  clock(): number { return this.now() }

  /**
   * Run a read-modify-write task inside the same transaction seam. Unlike
   * writeOne, task errors keep their type (state files rely on WRITE_GATE_ERROR_NAME)
   * and only committed-only failures become warnings. expected is optional because
   * the state medium passes the task the locked current value itself.
   */
  async run(target: { readonly path: string; readonly expected?: string | null | undefined }, task: (current: string | null) => string | null | Promise<string | null>): Promise<{ readonly warnings?: readonly string[] | undefined }> {
    let invoked = false
    let conflict = false
    let transactionWarnings: readonly string[] | undefined
    const invoke = async (current: string | null): Promise<string | null> => {
      if (target.expected !== undefined && current !== target.expected) {
        conflict = true
        throw Object.assign(new Error('concurrent modification detected: ' + target.path), { noWrite: true })
      }
      invoked = true
      return await task(current)
    }
    try {
      if (this.transact !== undefined) transactionWarnings = await this.transact(this.io, target.path, invoke)
      else transactionWarnings = await transactIo(this.io, target.path, invoke)
    } catch (error) {
      if (conflict) throw Object.assign(new Error('concurrent modification detected: ' + target.path), { noWrite: true })
      if (isCommittedWarning(error)) return { warnings: [error instanceof Error ? error.message : String(error)] }
      throw error
    }
    if (!invoked) throw new Error('internal error: the write transaction for ' + target.path + ' did not invoke the task; no write was performed')
    return transactionWarnings === undefined ? {} : { warnings: transactionWarnings }
  }

  /**
   * Write one target only if the current bytes still equal the baseline.
   * A conflict performs no write. With guardBaseline:false a stale callback
   * defers (returns the current bytes) so a retrying transact can re-observe;
   * if no retry ever writes, the result is still a conflict.
   */
  async writeOne(target: UnitTarget, options: UnitWriteOneOptions = {}): Promise<UnitKernelResult> {
    // A missing target is published with the filesystem's no-replace primitive
    // (hard link), so even a writer that ignores our locks cannot be silently
    // overwritten. Expected-present writes still go through the CAS transaction.
    if (target.expected === null && target.next !== null && this.io.createTextIfAbsent !== undefined) {
      try {
        await this.io.createTextIfAbsent(target.path, target.next)
        return { ok: true, changed: [target.path], errors: [] }
      } catch (error) {
        if (isCommittedWarning(error)) return { ok: true, changed: [target.path], errors: [], warnings: [error instanceof Error ? error.message : String(error)] }
        const code = (error as { code?: unknown } | undefined)?.code
        if (code === 'EEXIST' || code === 'ENOTEMPTY') return { ok: false, changed: [], errors: [{ code: 'cas-conflict', message: 'target appeared before create: ' + target.path, target: target.path }] }
        return { ok: false, changed: [], errors: [{ code: 'write-failed', message: error instanceof Error ? error.message : String(error), target: target.path }] }
      }
    }
    const guard = options.guardBaseline !== false
    let wrote = false
    let deferred = false
    let conflict = false
    let transactionWarnings: readonly string[] | undefined
    const task = (current: string | null): string | null => {
      if (current !== target.expected) {
        if (guard) {
          conflict = true
          throw Object.assign(new Error('concurrent modification detected: ' + target.path), { noWrite: true })
        }
        deferred = true
        return current
      }
      wrote = true
      return target.next
    }
    try {
      if (this.transact !== undefined) transactionWarnings = await this.transact(this.io, target.path, task)
      else transactionWarnings = await transactIo(this.io, target.path, task)
    } catch (error) {
      if (conflict) return { ok: false, changed: [], errors: [{ code: 'cas-conflict', message: error instanceof Error ? error.message : String(error), target: target.path }] }
      if (isCommittedWarning(error)) return { ok: true, changed: [target.path], errors: [], warnings: [error instanceof Error ? error.message : String(error)] }
      if (error instanceof TransactionNotInvokedError) return { ok: false, changed: [], errors: [{ code: 'transact-not-invoked', message: error.message, target: target.path }] }
      return { ok: false, changed: [], errors: [{ code: 'write-failed', message: error instanceof Error ? error.message : String(error), target: target.path }] }
    }
    if (conflict || (!wrote && deferred)) return { ok: false, changed: [], errors: [{ code: 'cas-conflict', message: 'concurrent modification detected: ' + target.path, target: target.path }] }
    if (!wrote) return { ok: false, changed: [], errors: [{ code: 'write-failed', message: 'transaction did not invoke the write task: ' + target.path, target: target.path }] }
    return { ok: true, changed: [target.path], errors: [], ...(transactionWarnings === undefined ? {} : { warnings: transactionWarnings }) }
  }

  /**
   * Read and verify every target without writing. A drift returns one
   * cas-conflict per target and leaves the filesystem untouched.
   */
  async prepare(targets: readonly UnitTarget[]): Promise<{ readonly ok: true; readonly prepared: PreparedUnit } | { readonly ok: false; readonly errors: readonly UnitKernelError[] }> {
    const errors: UnitKernelError[] = []
    for (const target of targets) {
      const current = await this.io.readText(target.path)
      if (current !== target.expected) errors.push({ code: 'cas-conflict', message: 'target changed after plan: ' + target.path, target: target.path })
    }
    return errors.length === 0 ? { ok: true, prepared: { targets } } : { ok: false, errors }
  }

  /**
   * Commit a unit that already passed {@link prepare}. This is the only write
   * point; a later failure compensates only the targets this commit wrote, and
   * only while they still hold this commit's bytes.
   */
  async commitPrepared(prepared: PreparedUnit): Promise<UnitKernelResult> {
    const written: UnitTarget[] = []
    for (const target of prepared.targets) {
      const result = await this.writeOne(target)
      if (!result.ok) {
        const compensation = await this.compensate(written)
        return { ok: false, changed: written.map(item => item.path), errors: [...result.errors, ...compensation] }
      }
      written.push(target)
    }
    return { ok: true, changed: written.map(item => item.path), errors: [] }
  }

  /** Prepare then commit; a preflight drift writes nothing. */
  async commit(targets: readonly UnitTarget[]): Promise<UnitKernelResult> {
    const prepared = await this.prepare(targets)
    if (!prepared.ok) return { ok: false, changed: [], errors: prepared.errors }
    return await this.commitPrepared(prepared.prepared)
  }

  /**
   * Restore a target to its before bytes only if it still holds the bytes this
   * unit wrote. A concurrent writer wins and the compensation is reported.
   */
  async restore(target: { readonly path: string; readonly before: string | null; readonly after: string | null }): Promise<UnitKernelResult> {
    const result = await this.writeOne({ path: target.path, expected: target.after, next: target.before })
    if (result.ok) return result
    if (result.errors.some(error => error.code === 'cas-conflict')) {
      return { ok: false, changed: [], errors: [{ code: 'compensation-blocked', message: 'compensation refused: target changed after this unit; leave the concurrent bytes in place', target: target.path }] }
    }
    return result
  }

  private async compensate(written: readonly UnitTarget[]): Promise<readonly UnitKernelError[]> {
    const errors: UnitKernelError[] = []
    for (const target of [...written].reverse()) {
      const result = await this.restore({ path: target.path, before: target.expected, after: target.next })
      if (!result.ok) errors.push(...result.errors)
    }
    return errors
  }
}
