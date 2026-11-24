import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isCommittedWarning, isProcessAlive, TransactionNotInvokedError, transactIo } from './io.ts'
import { exceedsContentLimit } from './frontmatter.ts'
import { TargetWriter } from './target-writer.ts'
import type { UnitClaimPort } from './unit-claim.ts'
import type { MutationOwner } from './contract.ts'

export interface MutationRoot {
  name: string
  protection: 'write' | 'delete' | 'none'
}

export type TreeChangeOp =
  | { kind: 'write'; target: string; content: string; expected?: string | null; skill?: string }
  | { kind: 'delete'; target: string; expected?: string | null; skill?: string }

export interface MutationRequest {
  name: string
  roots: MutationRoot[]
  ops: TreeChangeOp[]
  origin: string
  auditAction: string
  auditSummary: string
  eventAction: string
  unitId?: string
  dryRun?: boolean
  /** Optional root directory map; when present, every target must resolve under a declared root. */
  rootDirs?: Readonly<Record<string, string>>
  /** Sidecars that undo/recover must remove after restoring the ops (e.g. a create marker). */
  cleanupPaths?: readonly string[]
}

function underRoot(rootDir: string | undefined, target: string): boolean {
  if (rootDir === undefined || rootDir === '') return false
  const rel = relative(rootDir, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export interface MutationLimits {
  maxSkillFileBytes: number
  maxSkillContentChars: number
}

export interface MutationValidationError {
  code: string
  message: string
  target?: string
}

export interface MutationValidation {
  ok: boolean
  roots: MutationRoot[]
  ops: TreeChangeOp[]
  errors: MutationValidationError[]
}

/**
 * Pure preflight for one mutation request. It deliberately does no IO: the
 * caller must resolve roots and read bodies before this point; the unit kernel
 * performs CAS/protection/journal after validation.
 */
export function validateMutationRequest(
  request: MutationRequest,
  limits: MutationLimits,
): MutationValidation {
  const errors: MutationValidationError[] = []
  const roots: MutationRoot[] = []
  for (const root of request.roots) {
    const name = root.name.trim()
    if (name === '') {
      errors.push({ code: 'root-empty', message: 'mutation root name is empty' })
      continue
    }
    if (roots.some(entry => entry.name === name)) {
      errors.push({ code: 'root-duplicate', message: 'duplicate mutation root ' + name })
      continue
    }
    roots.push({ name, protection: root.protection })
  }
  const primary = request.name.trim()
  if (request.rootDirs !== undefined) {
    for (const root of roots) {
      if (request.rootDirs[root.name] === undefined) {
        errors.push({ code: 'root-dir-missing', message: 'no directory for mutation root ' + root.name })
      }
    }
  }
  if (!roots.some(root => root.name === primary)) {
    errors.push({ code: 'root-primary-missing', message: 'primary skill ' + primary + ' is not in roots' })
  }
  if (request.ops.length === 0) {
    errors.push({ code: 'ops-empty', message: 'mutation has no operations' })
  }
  const seen = new Set<string>()
  const ops: TreeChangeOp[] = []
  for (const op of request.ops) {
    const target = op.target.trim()
    if (target === '') {
      errors.push({ code: 'target-empty', message: 'operation target is empty' })
      continue
    }
    if (seen.has(target)) {
      errors.push({ code: 'target-duplicate', message: 'duplicate operation target ' + target, target })
      continue
    }
    seen.add(target)
    const skill = op.skill?.trim()
    if (skill !== undefined && !roots.some(root => root.name === skill)) {
      errors.push({ code: 'op-skill-unknown', message: 'operation skill ' + skill + ' is not in roots', target })
      continue
    }
    if (request.rootDirs !== undefined) {
      const owner = skill === undefined
        ? roots.find(root => underRoot(request.rootDirs?.[root.name], target))
        : underRoot(request.rootDirs[skill], target) ? { name: skill } : undefined
      if (owner === undefined) {
        errors.push({ code: 'target-outside-root', message: 'operation target is outside its declared root', target })
        continue
      }
    }
    if (op.kind === 'write') {
      const bytes = Buffer.byteLength(op.content, 'utf8')
      if (bytes > limits.maxSkillFileBytes) {
        errors.push({ code: 'file-too-large', message: 'write exceeds ' + limits.maxSkillFileBytes + ' bytes', target })
        continue
      }
      if (basename(target) === 'SKILL.md' && exceedsContentLimit(op.content, limits.maxSkillContentChars)) {
        errors.push({ code: 'skill-too-large', message: 'SKILL.md exceeds ' + limits.maxSkillContentChars + ' characters', target })
        continue
      }
      ops.push({ ...op, target })
    } else {
      ops.push({ ...op, target })
    }
  }
  return { ok: errors.length === 0, roots, ops, errors }
}


export interface MutationJournalRecord {
  unitId: string
  /** Unique journal key for this nested unit; unitId may be shared by a merge's sub-writes. */
  journalId?: string
  /** Run that owns this unit; absent for a foreground tree-change without a run. */
  runId?: string
  phase: 'prepared' | 'unit-written' | 'committed' | 'failed' | 'undone'
  changed: readonly string[]
  target?: string
  roots?: readonly string[]
  error?: string
}

export interface MutationJournalPort {
  write(record: MutationJournalRecord): Promise<void>
}

export interface MutationLockLease {
  release(): Promise<void>
}

export interface MutationLockPort {
  /**
   * Acquire the write lock. `targetKeys`, when supplied, asks a keyed backend
   * to lock those skill targets instead of the whole root; a backend that only
   * implements the root lock may ignore them.
   */
  acquire(targetKeys?: readonly string[]): Promise<MutationLockLease>
  /** True when this port locks per target key rather than the whole home. */
  readonly keyed?: boolean
  /** Best-effort removal of stale target lock files left by a failed release. */
  repair?(): Promise<{ readonly repaired: readonly string[]; readonly skipped: readonly string[] }>
}

export interface MutationSnapshotOp {
  target: string
  before: string | null
  after: string | null
  skill?: string
}

export interface MutationSnapshot {
  unitId: string
  journalId?: string
  state: 'prepared' | 'committed' | 'undone'
  ops: readonly MutationSnapshotOp[]
  cleanup?: readonly string[]
  createdAt: number
  owner?: MutationOwner
  runId?: string
  leaseId?: string
}

/** Identity attached to one UnitKernel's snapshot/journal writes. */
export interface UnitKernelContext {
  readonly owner: MutationOwner
  readonly runId: string
  readonly leaseId: string
}

export interface MutationSnapshotPort {
  write(snapshot: MutationSnapshot): Promise<void>
  read(unitId: string): Promise<MutationSnapshot | null>
  listPrepared?(): Promise<readonly MutationSnapshot[]>
}

export interface UnitKernelEvent {
  unitId: string
  changed: readonly string[]
  ops: readonly MutationSnapshotOp[]
  roots?: readonly string[]
}

export interface UnitKernelHooks {
  committed?(event: UnitKernelEvent): Promise<void> | void
  rolledBack?(event: UnitKernelEvent): Promise<void> | void
  undone?(event: UnitKernelEvent): Promise<void> | void
}

export interface UnitKernelOptions {
  io: import('./io.ts').EvolutionIoLike
  limits: MutationLimits
  serial?: <T>(task: () => Promise<T>) => Promise<T>
  lock?: MutationLockPort
  /** Canonical skill target keys whose keyed lock backend should be acquired. */
  targetKeys?: readonly string[]
  /** Recovery-only: derive keys from the snapshot being recovered. */
  targetKeysForSnapshot?: (snapshot: { readonly ops: readonly { readonly target: string }[] }) => readonly string[]
  /** Resolve logical target keys to the backend's canonical lock identity. */
  targetKeyResolver?: (keys: readonly string[]) => Promise<readonly string[]> | readonly string[]
  /** Explicit escape for a caller that already holds the home fence (nested merge/skill write). */
  nested?: boolean
  journal?: MutationJournalPort
  snapshots?: MutationSnapshotPort
  /** Optional merge target claim, acquired after the fence and released in finally. */
  claim?: UnitClaimPort
  claimRunId?: string
  hooks?: UnitKernelHooks
  /** Runs after the unit lease is released; a store writer can take HomeFence here. */
  afterCommit?: (event: UnitKernelEvent) => Promise<void> | void
  context?: UnitKernelContext
  validateWrite?: (op: TreeChangeOp) => string | null
  transact?: typeof transactIo
  /** @deprecated the kernel always re-checks the baseline; kept for source compatibility. */
  transactGuard?: boolean
  now?: () => number
}

type PreparedState = 'prepared' | 'committing' | 'released'

export interface PreparedMutation {
  readonly kind: 'prepared'
  readonly unitId: string
  readonly request: MutationRequest
  readonly primary: string
  readonly validation: MutationValidation
  readonly snapshots: readonly { target: string; before: string | null; after: string | null; baseline: string | null }[]
  readonly eventOps: readonly MutationSnapshotOp[]
  readonly changed: string[]
  readonly warnings: string[]
  readonly bestEffort: (task: () => Promise<void>) => Promise<void>
  release(): Promise<void>
}

export interface MutationResult {
  ok: boolean
  unitId: string
  dryRun: boolean
  changed: string[]
  errors: MutationValidationError[]
  warnings?: readonly string[]
}

export interface MutationPreviewResult {
  ok: boolean
  unitId: string
  roots: MutationRoot[]
  ops: TreeChangeOp[]
  errors: MutationValidationError[]
}

const noLock: MutationLockPort = {
  async acquire() {
    return { async release() {} }
  },
}

const identitySerial = async <T>(task: () => Promise<T>): Promise<T> => await task()

export class UnitKernel {
  private readonly io: import('./io.ts').EvolutionIoLike
  private readonly limits: MutationLimits
  private readonly serial: <T>(task: () => Promise<T>) => Promise<T>
  private readonly lock: MutationLockPort
  private readonly targetKeys: readonly string[] | undefined
  private readonly targetKeysForSnapshot: UnitKernelOptions['targetKeysForSnapshot'] | undefined
  private readonly targetKeyResolver: UnitKernelOptions['targetKeyResolver'] | undefined
  private readonly journal: MutationJournalPort | undefined
  private readonly snapshots: MutationSnapshotPort | undefined
  private readonly preparedStates = new WeakMap<object, PreparedState>()
  private readonly claim: UnitClaimPort | undefined
  private readonly claimRunId: string | undefined
  private readonly hooks: UnitKernelHooks | undefined
  private readonly afterCommit: ((event: UnitKernelEvent) => Promise<void> | void) | undefined
  private readonly context: UnitKernelContext | undefined
  private readonly validateWrite: ((op: TreeChangeOp) => string | null) | undefined
  private readonly kernel: TargetWriter
  private readonly transactGuard: boolean
  private readonly now: () => number
  private readonly journalId: string

  constructor(options: UnitKernelOptions) {
    this.io = options.io
    this.limits = options.limits
    this.serial = options.serial ?? identitySerial
    if (options.lock === undefined && options.nested !== true) {
      throw new Error('unit-kernel: a lock (or an explicit nested:true under an outer fence) is required')
    }
    this.lock = options.lock ?? noLock
  this.targetKeys = options.targetKeys
  this.targetKeysForSnapshot = options.targetKeysForSnapshot
    this.journal = options.journal
    this.snapshots = options.snapshots
    this.claim = options.claim
    this.claimRunId = options.claimRunId
    this.hooks = options.hooks
    this.afterCommit = options.afterCommit
    this.context = options.context
    this.validateWrite = options.validateWrite
    this.transactGuard = options.transactGuard !== false
    this.now = options.now ?? Date.now
    this.journalId = 'j-' + String(this.now()) + '-' + Math.random().toString(36).slice(2)
    const transact = options.transact
    this.kernel = new TargetWriter({ io: this.io, ...(transact === undefined ? {} : { transact }), now: this.now })
  }

  private async resolveTargetKeys(keys: readonly string[] | undefined): Promise<readonly string[] | undefined> {
    if (keys === undefined || this.targetKeyResolver === undefined) return keys
    return await this.targetKeyResolver(keys)
  }

  preview(request: MutationRequest): MutationPreviewResult {
    const validation = validateMutationRequest(request, this.limits)
    return {
      ok: validation.ok,
      unitId: request.unitId ?? 'preview-' + String(this.now()),
      roots: validation.roots,
      ops: validation.ops,
      errors: validation.errors,
    }
  }

  /**
   * Phase 1: acquire the lease/claim and read every target, verifying CAS and
   * write validation. This performs NO durable write (no journal, snapshot,
   * audit or event). The returned handle holds the lease until commit() or
   * release(); callers must use try/finally.
   */
  async prepare(request: MutationRequest): Promise<PreparedMutation | MutationResult> {
    const primary = request.name.trim()
    const unitId = request.unitId ?? 'u-' + String(this.now()) + '-' + Math.random().toString(36).slice(2)
    const validation = validateMutationRequest(request, this.limits)
    if (!validation.ok) return { ok: false, unitId, dryRun: request.dryRun === true, changed: [], errors: validation.errors }
    let lease: MutationLockLease
    try {
      lease = await this.lock.acquire(await this.resolveTargetKeys(this.targetKeys))
    } catch (error) {
      const code = error instanceof TransactionNotInvokedError ? 'transact-not-invoked' : 'unit-fence-failed'
      return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code, message: error instanceof Error ? error.message : String(error) }] }
    }
    let claim: { release(): Promise<void> } | undefined
    let handle: PreparedMutation
    const release = async (): Promise<void> => {
      if (handle !== undefined) {
        const current = this.preparedStates.get(handle)
        if (current === 'released') return
        this.preparedStates.set(handle, 'released')
      }
      await claim?.release().catch(() => {})
      await lease.release()
    }
    if (this.claim !== undefined) {
      try {
        claim = await this.claim.acquire(primary, this.claimRunId ?? this.context?.runId ?? '')
      } catch (error) {
        await lease.release()
        return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'claim-failed', message: error instanceof Error ? error.message : String(error) }] }
      }
    }
    const snapshots: Array<{ target: string; before: string | null; after: string | null; baseline: string | null }> = []
    try {
      for (const op of validation.ops) {
        const current = await this.io.readText(op.target)
        const baseline = op.expected === undefined ? current : op.expected
        if (current !== baseline) {
          await release()
          return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'cas-drift', message: 'target changed after plan', target: op.target }] }
        }
        snapshots.push({ target: op.target, before: current, after: op.kind === 'write' ? op.content : null, baseline })
      }
      for (const op of validation.ops) {
        const refusal = this.validateWrite?.(op) ?? null
        if (refusal !== null) {
          await release()
          return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'write-validation', message: refusal, target: op.target }] }
        }
      }
    } catch (error) {
      await release()
      return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'write-failed', message: error instanceof Error ? error.message : String(error) }] }
    }
    const eventOps: MutationSnapshotOp[] = snapshots.map(snapshot => {
      const op = validation.ops.find(entry => entry.target === snapshot.target)
      return {
        target: snapshot.target,
        before: snapshot.before,
        after: op?.kind === 'write' ? op.content : null,
        ...(op?.skill === undefined ? {} : { skill: op.skill }),
      }
    })
    const changed: string[] = []
    const warnings: string[] = []
    const bestEffort = async (task: () => Promise<void>): Promise<void> => {
      try {
        await task()
      } catch (error) {
        if (!isCommittedWarning(error)) throw error
        warnings.push(error instanceof Error ? error.message : String(error))
      }
    }
    handle = { kind: 'prepared', unitId, request, primary, validation, snapshots, eventOps, changed, warnings, bestEffort, release }
    this.preparedStates.set(handle, 'prepared')
    return handle
  }

  /** Phase 2: the only durable write phase. Releases the prepare lease in all paths. */
  async commit(prepared: PreparedMutation): Promise<MutationResult> {
    const current = this.preparedStates.get(prepared)
    if (current !== 'prepared') {
      return { ok: false, unitId: prepared.unitId, dryRun: false, changed: [], errors: [{ code: 'unit-handle-consumed', message: 'prepared mutation is already ' + String(current) }] }
    }
    this.preparedStates.set(prepared, 'committing')
    const { unitId, request, primary, validation, snapshots, eventOps, changed, warnings, bestEffort } = prepared
    const cleanup = request.cleanupPaths === undefined ? {} : { cleanup: request.cleanupPaths }
    let result: MutationResult
    try {
      if (this.snapshots !== undefined) await bestEffort(() => this.snapshots!.write({ unitId, journalId: this.journalId, state: 'prepared', ops: eventOps, ...cleanup, createdAt: this.now(), ...this.contextFields() }))
      await bestEffort(async () => this.journal?.write({ unitId, journalId: this.journalId, ...(this.context?.runId === undefined ? {} : { runId: this.context.runId }), phase: 'prepared', changed: [], target: validation.roots.find(root => root.name === primary)?.name ?? primary, roots: validation.roots.map(root => root.name) }))
      for (const op of validation.ops) {
        const snapshot = snapshots.find(entry => entry.target === op.target)
        if (snapshot === undefined) throw new Error('snapshot missing for ' + op.target)
        try {
          const opWarnings = await this.applyOp(op, snapshot.baseline)
          warnings.push(...opWarnings)
          changed.push(op.target)
        } catch (error) {
          if ((error as { noWrite?: boolean } | undefined)?.noWrite !== true) changed.push(op.target)
          if (!isCommittedWarning(error)) throw error
          warnings.push(error instanceof Error ? error.message : String(error))
        }
      }
      await bestEffort(async () => this.journal?.write({ unitId, journalId: this.journalId, ...(this.context?.runId === undefined ? {} : { runId: this.context.runId }), phase: 'unit-written', changed, target: primary, roots: validation.roots.map(root => root.name) }))
      // The snapshot is the recovery authority: only a failed snapshot write may
      // roll the unit back. A journal write after this point is diagnostic; a
      // missing journal record must not turn a committed snapshot into a
      // rollback plus a committed snapshot.
      if (this.snapshots !== undefined) await this.snapshots!.write({ unitId, journalId: this.journalId, state: 'committed', ops: eventOps, ...cleanup, createdAt: this.now(), ...this.contextFields() })
      try {
        await this.journal?.write({ unitId, journalId: this.journalId, ...(this.context?.runId === undefined ? {} : { runId: this.context.runId }), phase: 'committed', changed, target: primary, roots: validation.roots.map(root => root.name) })
      } catch (error) {
        warnings.push('journal committed write failed: ' + (error instanceof Error ? error.message : String(error)))
      }
      try {
        await this.hooks?.committed?.({ unitId, changed, ops: eventOps, roots: validation.roots.map(root => root.name) })
      } catch {
        // Hooks are audit/history/event side effects; a completed write must not be rolled back by one.
      }
      result = { ok: true, unitId, dryRun: false, changed, errors: [], ...(warnings.length === 0 ? {} : { warnings }) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      let rollbackFailure = ''
      try {
        await this.rollback(snapshots.filter(snapshot => changed.includes(snapshot.target)))
      } catch (rollbackError) {
        rollbackFailure = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      }
      const detail = rollbackFailure === '' ? message : message + '; rollback failed: ' + rollbackFailure
      const failureCode = (error as { code?: string } | undefined)?.code === 'transact-not-invoked' ? 'transact-not-invoked' : 'write-failed'
      try {
        await this.journal?.write({ unitId, journalId: this.journalId, ...(this.context?.runId === undefined ? {} : { runId: this.context.runId }), phase: 'failed', changed, error: detail })
      } catch (journalError) {
        warnings.push('journal failed write failed: ' + (journalError instanceof Error ? journalError.message : String(journalError)))
      }
      try {
        await this.hooks?.rolledBack?.({
          unitId,
          changed,
          ops: snapshots.map(snapshot => {
            const op = validation.ops.find(entry => entry.target === snapshot.target)
            return {
              target: snapshot.target,
              before: snapshot.before,
              after: op?.kind === 'write' ? op.content : null,
              ...(op?.skill === undefined ? {} : { skill: op.skill }),
            }
          }),
          roots: validation.roots.map(root => root.name),
        })
      } catch {
        // best-effort hook; the structured write error remains authoritative
      }
      result = { ok: false, unitId, dryRun: false, changed, errors: [{ code: failureCode, message: detail }] }
    } finally {
      await prepared.release()
    }
    if (result.ok && this.afterCommit !== undefined) {
      try {
        await this.afterCommit({ unitId, changed, ops: eventOps, roots: validation.roots.map(root => root.name) })
      } catch (error) {
        const message = 'after-commit hook failed: ' + (error instanceof Error ? error.message : String(error))
        result = { ...result, warnings: [...(result.warnings ?? []), message] }
      }
    }
    return result
  }

  async apply(request: MutationRequest): Promise<MutationResult> {
    if (request.dryRun === true) {
      const unitId = request.unitId ?? 'u-' + String(this.now()) + '-' + Math.random().toString(36).slice(2)
      const validation = validateMutationRequest(request, this.limits)
      return validation.ok
        ? { ok: true, unitId, dryRun: true, changed: [], errors: [] }
        : { ok: false, unitId, dryRun: true, changed: [], errors: validation.errors }
    }
    return await this.serial(async () => {
      const prepared = await this.prepare(request)
      if ((prepared as PreparedMutation).kind !== 'prepared') return prepared as MutationResult
      return await this.commit(prepared as PreparedMutation)
    })
  }

  /** Recover every prepared snapshot known to the port; safe to call at boot. */
  async recoverPrepared(): Promise<MutationResult[]> {
    const prepared = await this.snapshots?.listPrepared?.() ?? []
    const results: MutationResult[] = []
    for (const snapshot of prepared) results.push(await this.recover(snapshot.unitId))
    return results
  }

  /** Converge a prepared unit left by a crash. Every path must be at its after-bytes; a drift refuses the whole recovery. */
  async recover(unitId: string): Promise<MutationResult> {
    const snapshot = await this.snapshots?.read(unitId)
    if (snapshot === undefined || snapshot === null) {
      return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'recover-missing-snapshot', message: 'no snapshot for ' + unitId }] }
    }
    if (snapshot.state !== 'prepared') {
      return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'recover-not-needed', message: 'unit is not prepared: ' + unitId }] }
    }
    return await this.serial(async () => {
      let lease: MutationLockLease
      try {
        lease = await this.lock.acquire(await this.resolveTargetKeys(this.targetKeysForSnapshot?.(snapshot) ?? this.targetKeys))
      } catch (error) {
        const code = error instanceof TransactionNotInvokedError ? 'transact-not-invoked' : 'unit-fence-failed'
        return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code, message: error instanceof Error ? error.message : String(error) }] }
      }
      const reverted: string[] = []
      try {
        for (const op of [...snapshot.ops].reverse()) {
          const current = await this.io.readText(op.target)
          if (current === op.before) continue
          if (current !== op.after) {
            return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'recover-drift', message: 'target is neither before nor after: ' + op.target }] }
          }
          const inverse: TreeChangeOp = op.before === null
            ? { kind: 'delete', target: op.target, ...(op.skill === undefined ? {} : { skill: op.skill }) }
            : { kind: 'write', target: op.target, content: op.before, ...(op.skill === undefined ? {} : { skill: op.skill }) }
          await this.applyOp(inverse, op.after)
          reverted.push(op.target)
        }
        for (const path of snapshot.cleanup ?? []) await this.io.remove(path).catch(() => {})
        await this.snapshots?.write({ ...snapshot, state: 'undone' })
        await this.journal?.write({ unitId, journalId: snapshot.journalId ?? this.journalId, ...(this.context?.runId === undefined ? {} : { runId: this.context.runId }), phase: 'undone', changed: reverted, ...(snapshot.ops[0]?.target === undefined ? {} : { target: snapshot.ops[0].target }), roots: [...new Set(snapshot.ops.map(op => op.skill).filter((skill): skill is string => skill !== undefined))] })
        try {
          await this.hooks?.undone?.({ unitId, changed: reverted, ops: snapshot.ops, roots: [...new Set(snapshot.ops.map(op => op.skill).filter((skill): skill is string => skill !== undefined))] })
        } catch {
          // best-effort hook
        }
        return { ok: true, unitId, dryRun: false, changed: reverted, errors: [] }
      } catch (error) {
        return { ok: false, unitId, dryRun: false, changed: reverted, errors: [{ code: 'recover-failed', message: error instanceof Error ? error.message : String(error) }] }
      } finally {
        await lease.release()
      }
    })
  }

  private contextFields(): Pick<MutationSnapshot, 'owner' | 'runId' | 'leaseId'> {
    return this.context === undefined ? {} : { owner: this.context.owner, runId: this.context.runId, leaseId: this.context.leaseId }
  }

  async undo(unitId: string): Promise<MutationResult> {
    const snapshot = await this.snapshots?.read(unitId)
    if (snapshot === undefined || snapshot === null) {
      return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'undo-missing-snapshot', message: 'no committed snapshot for ' + unitId }] }
    }
    if (snapshot.state === 'prepared') {
      return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'undo-needs-recovery', message: 'unit has a prepared snapshot; run recover first: ' + unitId }] }
    }
    if (snapshot.state === 'undone') {
      return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'undo-already', message: 'unit already undone: ' + unitId }] }
    }
    return await this.serial(async () => {
      let lease: MutationLockLease
      try {
        lease = await this.lock.acquire(await this.resolveTargetKeys(this.targetKeys))
      } catch (error) {
        return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'lock-failed', message: error instanceof Error ? error.message : String(error) }] }
      }
      const undone: string[] = []
      try {
        for (const op of snapshot.ops) {
          const current = await this.io.readText(op.target)
          if (current !== op.after) {
            return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'undo-preflight', message: 'target changed after the unit: ' + op.target }] }
          }
        }
        for (const op of [...snapshot.ops].reverse()) {
          const inverse: TreeChangeOp = op.before === null
            ? { kind: 'delete', target: op.target, ...(op.skill === undefined ? {} : { skill: op.skill }) }
            : { kind: 'write', target: op.target, content: op.before, ...(op.skill === undefined ? {} : { skill: op.skill }) }
          await this.applyOp(inverse, op.after)
          undone.push(op.target)
        }
        for (const path of snapshot.cleanup ?? []) await this.io.remove(path).catch(() => {})
        await this.journal?.write({ unitId, journalId: snapshot.journalId === undefined ? this.journalId : snapshot.journalId + ':undo', ...(this.context?.runId === undefined ? {} : { runId: this.context.runId }), phase: 'undone', changed: undone, ...(snapshot.ops[0]?.target === undefined ? {} : { target: snapshot.ops[0].target }), roots: [...new Set(snapshot.ops.map(op => op.skill).filter((skill): skill is string => skill !== undefined))] })
        await this.snapshots?.write({ ...snapshot, state: 'undone' })
        try {
          await this.hooks?.undone?.({ unitId, changed: undone, ops: snapshot.ops, roots: [...new Set(snapshot.ops.map(op => op.skill).filter((skill): skill is string => skill !== undefined))] })
        } catch {
          // best-effort hook; the undo itself already landed
        }
        return { ok: true, unitId, dryRun: false, changed: undone, errors: [] }
      } catch (error) {
        for (const target of undone.reverse()) {
          const op = snapshot.ops.find(entry => entry.target === target)
          if (op === undefined) continue
          try {
            // restore(target) writes `before` only while the current bytes equal `after`; the undo
            // wrote op.before, so the compensation passes (before=op.after, after=op.before).
            const restored = await this.kernel.restore({ path: target, before: op.after, after: op.before })
            if (!restored.ok) throw new Error(restored.errors[0]?.message ?? 'compensation blocked: ' + target)
          } catch {
            // best-effort undo compensation; the structured error below remains honest
          }
        }
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, unitId, dryRun: false, changed: undone, errors: [{ code: 'undo-failed', message }] }
      } finally {
        await lease.release()
      }
    })
  }

  private async applyOp(op: TreeChangeOp, baseline: string | null): Promise<string[]> {
    const result = await this.kernel.writeOne({ path: op.target, expected: baseline, next: op.kind === 'delete' ? null : op.content, ...op.skill === undefined ? {} : { skill: op.skill } }, { guardBaseline: this.transactGuard })
    if (!result.ok) throw Object.assign(new Error(result.errors[0]?.message ?? 'write failed: ' + op.target), { noWrite: true, code: result.errors[0]?.code })
    return [...(result.warnings ?? [])]
  }

  private async rollback(snapshots: ReadonlyArray<{ target: string; before: string | null; after: string | null }>): Promise<void> {
    // A5: one blocked target must not stop compensation of the others. A later target whose bytes
    // still match this unit is restorable; only the blocked one is left for the prepared snapshot.
    const errors: string[] = []
    for (const snapshot of [...snapshots].reverse()) {
      const result = await this.kernel.restore({ path: snapshot.target, before: snapshot.before, after: snapshot.after })
      if (!result.ok) errors.push(snapshot.target + ': ' + (result.errors[0]?.message ?? 'rollback failed'))
    }
    if (errors.length > 0) throw new Error('rollback incomplete: ' + errors.join('; '))
  }
}


interface FileLockRecord {
  token: string
  pid: number
  startedAt: number
}

export interface FileMutationLockOptions {
  waitMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

function parseFileLock(raw: string | null): FileLockRecord | undefined {
  if (raw === null) return undefined
  try {
    const value = JSON.parse(raw) as Partial<FileLockRecord>
    if (typeof value.token !== 'string' || typeof value.pid !== 'number' || typeof value.startedAt !== 'number') return undefined
    return { token: value.token, pid: value.pid, startedAt: value.startedAt }
  } catch {
    return undefined
  }
}

const defaultSleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

/**
 * Cross-process root mutation lock. A live holder is never stolen; a dead pid
 * or corrupt record can be taken over. This is separate from merge's run-level
 * tree lock so an ordinary skill write cannot deadlock a merge run.
 */
export function fileMutationLock(
  io: import('./io.ts').EvolutionIoLike,
  root: string,
  options: FileMutationLockOptions = {},
): MutationLockPort {
  const path = join(dirname(root), '.' + basename(root) + '.mutation-lock')
  const waitMs = options.waitMs ?? 5000
  const pollMs = options.pollMs ?? 25
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep

  const update = async (task: (current: string | null) => string | null): Promise<void> => {
    await transactIo(io, path, task)
  }

  return {
    async acquire(): Promise<MutationLockLease> {
      const deadline = now() + waitMs
      for (;;) {
        const token = randomUUID()
        let acquired = false
        await update(current => {
          const existing = parseFileLock(current)
          if (existing !== undefined && isProcessAlive(existing.pid)) return current
          acquired = true
          return JSON.stringify({ token, pid: process.pid, startedAt: now() })
        })
        if (acquired) {
          let released = false
          return {
            async release(): Promise<void> {
              if (released) return
              released = true
              await update(current => {
                const record = parseFileLock(current)
                return record?.token === token ? null : current
              })
            },
          }
        }
        if (now() >= deadline) throw new Error('mutation-lock-busy: ' + path)
        await sleep(Math.min(pollMs, Math.max(0, deadline - now())))
      }
    },
  }
}
