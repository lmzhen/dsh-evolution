import type { EvolutionIoLike } from './io.ts'
import { isCommittedWarning, transactIo } from './io.ts'

/** The four persistent writer kinds the family permits. */
export type WriteUnitKind = 'skill' | 'state' | 'merge' | 'curator'

/** One planned write: expected is the baseline read before the plan, next is the new bytes. */
export interface WriteTarget {
  readonly path: string
  readonly expected: string | null
  readonly next: string | null
  readonly skill?: string | undefined
}

/** A structured failure; conflict always means the target changed before/inside the write. */
export interface WriteKernelError {
  readonly code: 'cas-conflict' | 'write-failed' | 'compensation-blocked'
  readonly message: string
  readonly target: string
}

/** Outcome of one write or one multi-target commit. */
export interface WriteKernelResult {
  readonly ok: boolean
  readonly changed: readonly string[]
  readonly errors: readonly WriteKernelError[]
  readonly warnings?: readonly string[] | undefined
}

export interface WriteKernelOptions {
  readonly io: EvolutionIoLike
  readonly transact?: typeof transactIo | undefined
  readonly now?: (() => number) | undefined
}

/**
 * The family's single write primitive: compare the baseline INSIDE the write
 * transaction, never overwrite a concurrent value, and compensate only this
 * unit's own writes. Business state machines stay in their domain owners.
 */
export class WriteKernel {
  private readonly io: EvolutionIoLike
  private readonly transact: typeof transactIo
  private readonly now: () => number

  constructor(options: WriteKernelOptions) {
    this.io = options.io
    this.transact = options.transact ?? transactIo
    this.now = options.now ?? Date.now
  }

  /** @returns the current time source; exposed for adapters that stamp evidence. */
  clock(): number { return this.now() }

  /**
   * Write one target only if the current bytes still equal the baseline.
   * A conflict performs no write.
   */
  async writeOne(target: WriteTarget): Promise<WriteKernelResult> {
    let conflict = false
    try {
      await this.transact(this.io, target.path, current => {
        if (current !== target.expected) {
          conflict = true
          throw Object.assign(new Error('concurrent modification detected: ' + target.path), { noWrite: true })
        }
        return target.next
      })
    } catch (error) {
      if (conflict) return { ok: false, changed: [], errors: [{ code: 'cas-conflict', message: error instanceof Error ? error.message : String(error), target: target.path }] }
      if (isCommittedWarning(error)) return { ok: true, changed: [target.path], errors: [], warnings: [error instanceof Error ? error.message : String(error)] }
      return { ok: false, changed: [], errors: [{ code: 'write-failed', message: error instanceof Error ? error.message : String(error), target: target.path }] }
    }
    if (conflict) return { ok: false, changed: [], errors: [{ code: 'cas-conflict', message: 'concurrent modification detected: ' + target.path, target: target.path }] }
    return { ok: true, changed: [target.path], errors: [] }
  }

  /**
   * Write a plan in order. A preflight drift writes nothing; a later failure
   * compensates only the targets this commit wrote, and only while they still
   * hold this commit's bytes.
   */
  async commit(targets: readonly WriteTarget[]): Promise<WriteKernelResult> {
    for (const target of targets) {
      const current = await this.io.readText(target.path)
      if (current !== target.expected) {
        return { ok: false, changed: [], errors: [{ code: 'cas-conflict', message: 'target changed after plan: ' + target.path, target: target.path }] }
      }
    }
    const written: WriteTarget[] = []
    for (const target of targets) {
      const result = await this.writeOne(target)
      if (!result.ok) {
        const compensation = await this.compensate(written)
        return { ok: false, changed: written.map(target => target.path), errors: [...result.errors, ...compensation] }
      }
      written.push(target)
    }
    return { ok: true, changed: written.map(target => target.path), errors: [] }
  }

  /**
   * Restore a target to its before bytes only if it still holds the bytes this
   * unit wrote. A concurrent writer wins and the compensation is reported.
   */
  async restore(target: { readonly path: string; readonly before: string | null; readonly after: string | null }): Promise<WriteKernelResult> {
    const result = await this.writeOne({ path: target.path, expected: target.after, next: target.before })
    if (result.ok) return result
    if (result.errors.some(error => error.code === 'cas-conflict')) {
      return { ok: false, changed: [], errors: [{ code: 'compensation-blocked', message: 'compensation refused: target changed after this unit; leave the concurrent bytes in place', target: target.path }] }
    }
    return result
  }

  private async compensate(written: readonly WriteTarget[]): Promise<readonly WriteKernelError[]> {
    const errors: WriteKernelError[] = []
    for (const target of [...written].reverse()) {
      const result = await this.restore({ path: target.path, before: target.expected, after: target.next })
      if (!result.ok) errors.push(...result.errors)
    }
    return errors
  }
}
