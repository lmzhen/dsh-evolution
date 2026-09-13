import { expect, it, vi } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo, pendingSelfCleanup } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

// S1.3 (v37, P1-6/P2-27): the READ-FAILURE paths of the io write-lock protocol.
// An unreadable OWN lock is the one shape a test cannot produce with ACLs
// portably (icacls is win32-only, chmod 000 is a no-op for the owner), so the
// reads are faulted: armed per path and per 1-based read number, where #1 is the
// commit-point assertOwned read and #2 the release read of the same write (a
// successful O_EXCL create reads the lock nowhere else).
const { faults } = vi.hoisted(() => ({
  faults: new Map<string, { nth: number; seen: number; left: number; fired: number }>(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const passthrough = actual.readFile as (...args: unknown[]) => Promise<unknown>
  return {
    ...actual,
    default: actual,
    readFile: async (path: unknown, ...rest: unknown[]) => {
      const fault = faults.get(String(path))
      if (fault !== undefined && fault.left > 0) {
        fault.seen += 1
        if (fault.seen >= fault.nth) {
          fault.left -= 1
          fault.fired += 1
          const reason = 'EACCES: injected read fault for ' + String(path)
          throw Object.assign(new Error(reason), { code: 'EACCES' })
        }
      }
      return passthrough(path, ...rest)
    },
  }
})

/** Fail every read of path from the nth one on, times times (default once). */
function armReadFault(path: string, nth: number, times = 1): void {
  faults.set(path, { nth, seen: 0, left: times, fired: 0 })
}

/** How many reads of PATH the armed fault actually threw for. */
function faultedReads(path: string): number {
  return faults.get(path)?.fired ?? 0
}

it('S1.3 (P1-6): an unreadable own lock at release is recorded with the claim it wrote, never rm-ed, and the next write self-heals it', async () => {
  const root = await tempRoot('dsh-io-release-read-')
  const io = nodeEvolutionIo(4)
  const target = join(root, 'release.txt')
  const lock = target + '.lock'
  pendingSelfCleanup.delete(lock)
  try {
    armReadFault(lock, 2)
    await io.writeText(target, 'first')
    // The fault landed exactly on the release read; the payload is committed.
    expect(faultedReads(lock)).toBe(1)
    expect(await readFile(target, 'utf8')).toBe('first')
    const leaked = await readFile(lock, 'utf8')
    expect(leaked).toMatch(new RegExp('^' + String(process.pid) + ':[0-9a-f]+$'))
    // An unverifiable name is never deleted (a peer may hold it now - the
    // 0.3.28 cascade), but the claim we wrote is registered with the SAME
    // byte-compare token the self-heal uses, so the leak stays recoverable.
    expect(pendingSelfCleanup.get(lock)).toBe(leaked)
    // The next write to this path recycles the leftover instead of failing
    // loud until the process exits.
    await io.writeText(target, 'second')
    expect(await readFile(target, 'utf8')).toBe('second')
    expect(await io.readText(lock)).toBeNull()
    expect(pendingSelfCleanup.has(lock)).toBe(false)
  } finally {
    faults.delete(lock)
    pendingSelfCleanup.delete(lock)
  }
})

it('S1.3 (P2-27): a transient commit-point read failure is retried in place - no preemption claim, no redo of the RMW', async () => {
  const root = await tempRoot('dsh-io-assert-read-')
  const io = nodeEvolutionIo(4)
  const target = join(root, 'commit.json')
  const lock = target + '.lock'
  pendingSelfCleanup.delete(lock)
  const warns: string[] = []
  const originalWarn = console.warn
  let runs = 0
  let fired = 0
  try {
    console.warn = (message?: unknown) => { warns.push(String(message)) }
    armReadFault(lock, 1)
    await io.transact!(target, async (current) => { runs += 1; return (current ?? '') + 'x' })
    fired = faultedReads(lock)
  } finally {
    console.warn = originalWarn
    faults.delete(lock)
    pendingSelfCleanup.delete(lock)
  }
  expect(fired).toBe(1)
  // ONE callback run: a LostWriteLock here would redo the whole RMW and double
  // the task's side effects (memory-store's failure() counter).
  expect(runs).toBe(1)
  expect(await readFile(target, 'utf8')).toBe('x')
  // A read failure is not a takeover: no log line may assert an external
  // preemption that never happened.
  const logged = warns.join('\n')
  expect(logged).not.toMatch(/preempted/i)
  expect(logged).not.toMatch(/reclaimed by another writer/)
  expect(await io.readText(lock)).toBeNull()
})

it('S1.3 (P2-27): a lock that stays unreadable aborts the write loudly, still without a preemption claim', async () => {
  const root = await tempRoot('dsh-io-assert-read-stuck-')
  const io = nodeEvolutionIo(2)
  const target = join(root, 'stuck.json')
  const lock = target + '.lock'
  pendingSelfCleanup.delete(lock)
  const warns: string[] = []
  const originalWarn = console.warn
  let runs = 0
  try {
    console.warn = (message?: unknown) => { warns.push(String(message)) }
    armReadFault(lock, 1, Number.MAX_SAFE_INTEGER)
    await expect(io.transact!(target, async (current) => { runs += 1; return (current ?? '') + 'x' }))
      .rejects.toThrow(/could not acquire write lock/)
  } finally {
    console.warn = originalWarn
    faults.delete(lock)
  }
  expect(runs).toBe(1)
  // Nothing was committed under an unverified claim, and the log still does not
  // invent a takeover.
  expect(await io.readText(target)).toBeNull()
  const logged = warns.join('\n')
  expect(logged).not.toMatch(/preempted/i)
  expect(logged).not.toMatch(/reclaimed by another writer/)
  // The unreadable name stays (never rm-ed unverified) and carries the claim
  // registration, so a later write recovers instead of leaking forever.
  expect(pendingSelfCleanup.get(lock)).toBe(await readFile(lock, 'utf8'))
  await rm(lock, { force: true })
  pendingSelfCleanup.delete(lock)
})
