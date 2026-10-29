import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isCommittedWarning, isProcessAlive, type transactIo } from './io.ts'

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
      if (basename(target) === 'SKILL.md' && op.content.length > limits.maxSkillContentChars) {
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
  acquire(): Promise<MutationLockLease>
}

export interface MutationSnapshotOp {
  target: string
  before: string | null
  after: string | null
  skill?: string
}

export interface MutationSnapshot {
  unitId: string
  state: 'prepared' | 'committed' | 'undone'
  ops: readonly MutationSnapshotOp[]
  cleanup?: readonly string[]
  createdAt: number
}

export interface MutationSnapshotPort {
  write(snapshot: MutationSnapshot): Promise<void>
  read(unitId: string): Promise<MutationSnapshot | null>
  listPrepared?(): Promise<readonly MutationSnapshot[]>
}

export interface MutationUnitEvent {
  unitId: string
  changed: readonly string[]
  ops: readonly MutationSnapshotOp[]
  roots?: readonly string[]
}

export interface MutationUnitHooks {
  committed?(event: MutationUnitEvent): Promise<void> | void
  rolledBack?(event: MutationUnitEvent): Promise<void> | void
  undone?(event: MutationUnitEvent): Promise<void> | void
}

export interface MutationUnitOptions {
  io: import('./io.ts').EvolutionIoLike
  limits: MutationLimits
  serial?: <T>(task: () => Promise<T>) => Promise<T>
  lock?: MutationLockPort
  journal?: MutationJournalPort
  snapshots?: MutationSnapshotPort
  hooks?: MutationUnitHooks
  validateWrite?: (op: TreeChangeOp) => string | null
  transact?: typeof transactIo
  /** Whether the io.transact callback re-checks the baseline. Default true; create sets false under its outer root lock. */
  transactGuard?: boolean
  now?: () => number
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

export class MutationUnit {
  private readonly io: import('./io.ts').EvolutionIoLike
  private readonly limits: MutationLimits
  private readonly serial: <T>(task: () => Promise<T>) => Promise<T>
  private readonly lock: MutationLockPort
  private readonly journal: MutationJournalPort | undefined
  private readonly snapshots: MutationSnapshotPort | undefined
  private readonly hooks: MutationUnitHooks | undefined
  private readonly validateWrite: ((op: TreeChangeOp) => string | null) | undefined
  private readonly transact: typeof transactIo | undefined
  private readonly transactGuard: boolean
  private readonly now: () => number

  constructor(options: MutationUnitOptions) {
    this.io = options.io
    this.limits = options.limits
    this.serial = options.serial ?? identitySerial
    this.lock = options.lock ?? noLock
    this.journal = options.journal
    this.snapshots = options.snapshots
    this.hooks = options.hooks
    this.validateWrite = options.validateWrite
    this.transact = options.transact
    this.transactGuard = options.transactGuard ?? true
    this.now = options.now ?? Date.now
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

  async apply(request: MutationRequest): Promise<MutationResult> {
    const primary = request.name.trim()
    const unitId = request.unitId ?? 'u-' + String(this.now()) + '-' + Math.random().toString(36).slice(2)
    const validation = validateMutationRequest(request, this.limits)
    if (!validation.ok) return { ok: false, unitId, dryRun: request.dryRun === true, changed: [], errors: validation.errors }
    if (request.dryRun === true) return { ok: true, unitId, dryRun: true, changed: [], errors: [] }
    return await this.serial(async () => {
      let lease: MutationLockLease
      try {
        lease = await this.lock.acquire()
      } catch (error) {
        return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'lock-failed', message: error instanceof Error ? error.message : String(error) }] }
      }
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
      const snapshots: Array<{ target: string; before: string | null; baseline: string | null }> = []
      try {
        for (const op of validation.ops) {
          const current = await this.io.readText(op.target)
          const baseline = op.expected === undefined ? current : op.expected
          if (current !== baseline) {
            return { ok: false, unitId, dryRun: false, changed, errors: [{ code: 'cas-drift', message: 'target changed after plan', target: op.target }] }
          }
          snapshots.push({ target: op.target, before: current, baseline })
        }
        for (const op of validation.ops) {
          const refusal = this.validateWrite?.(op) ?? null
          if (refusal !== null) return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'write-validation', message: refusal, target: op.target }] }
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
        const cleanup = request.cleanupPaths === undefined ? {} : { cleanup: request.cleanupPaths }
        if (this.snapshots !== undefined) await bestEffort(() => this.snapshots!.write({ unitId, state: 'prepared', ops: eventOps, ...cleanup, createdAt: this.now() }))
        await bestEffort(async () => this.journal?.write({ unitId, phase: 'prepared', changed: [], target: validation.roots.find(root => root.name === primary)?.name ?? primary, roots: validation.roots.map(root => root.name) }))
        for (const op of validation.ops) {
          const snapshot = snapshots.find(entry => entry.target === op.target)
          if (snapshot === undefined) throw new Error('snapshot missing for ' + op.target)
          try {
            await this.applyOp(op, snapshot.baseline)
            changed.push(op.target)
          } catch (error) {
            if ((error as { noWrite?: boolean } | undefined)?.noWrite !== true) changed.push(op.target)
            if (!isCommittedWarning(error)) throw error
            warnings.push(error instanceof Error ? error.message : String(error))
          }
        }
        await bestEffort(async () => this.journal?.write({ unitId, phase: 'unit-written', changed, target: primary, roots: validation.roots.map(root => root.name) }))
        await bestEffort(async () => this.journal?.write({ unitId, phase: 'committed', changed, target: primary, roots: validation.roots.map(root => root.name) }))
        if (this.snapshots !== undefined) await bestEffort(() => this.snapshots!.write({ unitId, state: 'committed', ops: eventOps, ...cleanup, createdAt: this.now() }))
        try {
          await this.hooks?.committed?.({ unitId, changed, ops: eventOps, roots: validation.roots.map(root => root.name) })
        } catch {
          // Hooks are audit/history/event side effects; a completed write must not be rolled back by one.
        }
        return { ok: true, unitId, dryRun: false, changed, errors: [], ...(warnings.length === 0 ? {} : { warnings }) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        let rollbackFailure = ''
        try {
          await this.rollback(snapshots.filter(snapshot => changed.includes(snapshot.target)))
        } catch (rollbackError) {
          rollbackFailure = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }
        const detail = rollbackFailure === '' ? message : message + '; rollback failed: ' + rollbackFailure
        await this.journal?.write({ unitId, phase: 'failed', changed, error: detail })
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
        return { ok: false, unitId, dryRun: false, changed, errors: [{ code: 'write-failed', message: detail }] }
      } finally {
        await lease.release()
      }
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
        lease = await this.lock.acquire()
      } catch (error) {
        return { ok: false, unitId, dryRun: false, changed: [], errors: [{ code: 'lock-failed', message: error instanceof Error ? error.message : String(error) }] }
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
        await this.journal?.write({ unitId, phase: 'undone', changed: reverted, ...(snapshot.ops[0]?.target === undefined ? {} : { target: snapshot.ops[0].target }), roots: [...new Set(snapshot.ops.map(op => op.skill).filter((skill): skill is string => skill !== undefined))] })
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
        lease = await this.lock.acquire()
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
        await this.journal?.write({ unitId, phase: 'undone', changed: undone, ...(snapshot.ops[0]?.target === undefined ? {} : { target: snapshot.ops[0].target }), roots: [...new Set(snapshot.ops.map(op => op.skill).filter((skill): skill is string => skill !== undefined))] })
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
            if (op.after === null) await this.io.remove(target)
            else await this.io.writeText(target, op.after)
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

  private async applyOp(op: TreeChangeOp, baseline: string | null): Promise<void> {
    if (this.transact !== undefined && op.kind === 'write') {
      let ran = false
      await this.transact(this.io, op.target, () => {
        ran = true
        return op.content
      })
      if (!ran) throw new Error('internal error: the write transaction did not invoke the task; no write was performed')
      return
    }

    const next = op.kind === 'delete' ? null : op.content
    if (this.io.transact !== undefined) {
      let conflict = false
      let wrote = false
      await this.io.transact(op.target, current => {
        if (current !== baseline) {
          if (this.transactGuard) throw new Error('concurrent modification detected: ' + op.target)
          conflict = true
          return current
        }
        wrote = true
        return next
      })
      if (conflict && !wrote) throw Object.assign(new Error('concurrent modification detected: ' + op.target), { noWrite: true })
      return
    }
    const current = await this.io.readText(op.target)
    if (current !== baseline) throw new Error('concurrent modification detected: ' + op.target)
    if (next === null) await this.io.remove(op.target)
    else await this.io.writeText(op.target, next)
  }

  private async rollback(snapshots: ReadonlyArray<{ target: string; before: string | null }>): Promise<void> {
    for (const snapshot of [...snapshots].reverse()) {
      if (snapshot.before === null) await this.io.remove(snapshot.target)
      else await this.io.writeText(snapshot.target, snapshot.before)
    }
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
    if (io.transact !== undefined) {
      let ran = false
      await io.transact(path, current => {
        ran = true
        return task(current)
      })
      if (!ran) throw new Error('mutation-lock-transact-not-run: ' + path)
      return
    }
    const current = await io.readText(path)
    const next = task(current)
    try {
      if (next === null) await io.remove(path)
      else await io.writeText(path, next)
    } catch (error) {
      if (!isCommittedWarning(error)) throw error
    }
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
