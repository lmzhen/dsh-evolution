/**
 * Cross-process tree write lock.
 *
 * The merge run holds this lock for its whole lifetime; curator's pass takes the same
 * lock. The lock is a cooperative file record, created through `transactIo` so two
 * processes cannot both win the create. A holder whose pid is gone is stale and may be
 * taken over; a live pid is always respected, even for a long run (a live long run is
 * exactly what the lock protects).
 *
 * `commitMerge` deliberately does NOT take this lock itself: the run shell owns it, so a
 * run and its commit share one acquisition. Taking it inside the store would also
 * deadlock the same-process curator path.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isProcessAlive, transactIo } from './io.ts'
import type { EvolutionIoLike } from './io.ts'

export interface TreeLockRecord {
  readonly token: string
  readonly epoch: number
  readonly pid: number
  readonly startedAt: number
}

export interface TreeLock {
  readonly token: string
  readonly epoch: number
  readonly path: string
  readonly acquiredAt: number
  release(): Promise<void>
  assertHeld(): Promise<boolean>
}

export type TreeLockAcquireResult =
  | { readonly ok: true; readonly lock: TreeLock }
  | { readonly ok: false; readonly reason: 'busy' | 'io'; readonly holder?: TreeLockRecord; readonly message?: string }

export interface TreeLockOptions {
  readonly io: EvolutionIoLike
  /** Evolution home; the lock lives at <home>/merge/.tree-lock. */
  readonly home: string
  /** How long to wait for a busy lock. Default 5000 ms. */
  readonly waitMs?: number
  /** Poll interval. Default 25 ms. */
  readonly pollMs?: number
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

/** The one lock path. */
export function treeLockFile(home: string): string {
  return join(home, 'merge', '.tree-lock')
}

function parseLock(raw: string | null): TreeLockRecord | undefined {
  if (raw === null) return undefined
  try {
    const value = JSON.parse(raw) as Partial<TreeLockRecord>
    if (typeof value.token !== 'string' || typeof value.pid !== 'number' || typeof value.startedAt !== 'number') return undefined
    return { token: value.token, epoch: typeof value.epoch === 'number' ? value.epoch : 0, pid: value.pid, startedAt: value.startedAt }
  } catch {
    return undefined
  }
}

const sleepDefault = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Read the current holder without creating or changing anything. */
export async function readTreeLock(io: EvolutionIoLike, home: string): Promise<TreeLockRecord | undefined> {
  return parseLock(await io.readText(treeLockFile(home)))
}

/** Try once. A stale record (dead pid or unparsable) is replaced. */
async function tryAcquire(io: EvolutionIoLike, home: string, now: () => number): Promise<{ token?: string; epoch?: number; holder?: TreeLockRecord }> {
  const path = treeLockFile(home)
  let token: string | undefined
  let epoch: number | undefined
  let holder: TreeLockRecord | undefined
  await transactIo(io, path, (current) => {
    const existing = parseLock(current)
    if (existing !== undefined && isProcessAlive(existing.pid)) {
      holder = existing
      return current
    }
    // Absent, corrupt, our own stale row, or a dead owner: take it and bump the epoch.
    token = randomUUID()
    epoch = (existing?.epoch ?? 0) + 1
    return JSON.stringify({ token, epoch, pid: process.pid, startedAt: now() })
  })
  return token === undefined ? (holder === undefined ? {} : { holder }) : { token, epoch: epoch ?? 0 }
}

/**
 * Acquire the tree write lock, waiting up to `waitMs`.
 *
 * A live holder is never stolen. A record whose pid is gone (or a corrupt record) is
 * taken over; that is how a killed process releases its lock without a timer.
 */
export async function acquireTreeWriteLock(options: TreeLockOptions): Promise<TreeLockAcquireResult> {
  const now = options.now ?? (() => Date.now())
  const waitMs = options.waitMs ?? 5_000
  const pollMs = options.pollMs ?? 25
  const sleep = options.sleep ?? sleepDefault
  const deadline = now() + Math.max(0, waitMs)
  let lastHolder: TreeLockRecord | undefined
  try {
    for (;;) {
      const attempt = await tryAcquire(options.io, options.home, now)
      if (attempt.token !== undefined) {
        const token = attempt.token
        const epoch = attempt.epoch ?? 0
        const path = treeLockFile(options.home)
        let released = false
        const lock: TreeLock = {
          token,
          epoch,
          path,
          acquiredAt: now(),
          async assertHeld() {
            const current = parseLock(await options.io.readText(path))
            return current?.token === token && current.epoch === epoch
          },
          async release() {
            if (released) return
            released = true
            await transactIo(options.io, path, (current) => {
              const existing = parseLock(current)
              return existing?.token === token && existing.epoch === epoch ? null : current
            })
          },
        }
        return { ok: true, lock }
      }
      lastHolder = attempt.holder
      if (now() >= deadline) break
      await sleep(pollMs)
    }
    return { ok: false, reason: 'busy', ...(lastHolder !== undefined ? { holder: lastHolder } : {}) }
  } catch (error) {
    return { ok: false, reason: 'io', message: error instanceof Error ? error.message : String(error) }
  }
}

/** Acquire, run, release; the lock is released even when the body throws. */
export async function withTreeWriteLock<T>(
  options: TreeLockOptions,
  body: (lock: TreeLock) => Promise<T>,
): Promise<{ ok: true; value: T } | Exclude<TreeLockAcquireResult, { ok: true }>> {
  const acquired = await acquireTreeWriteLock(options)
  if (!acquired.ok) return acquired
  try {
    return { ok: true, value: await body(acquired.lock) }
  } finally {
    await acquired.lock.release()
  }
}
