import { afterAll, expect, it, vi } from 'vitest'
// Contention tests spawn real fs races; full-suite parallel load can stretch
// them far beyond the vitest default (audit v10 integration fix).
vi.setConfig({ testTimeout: 30_000 })
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile, readFile, utimes, open } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeEvolutionIo, pendingSelfCleanup, renameWithRetry, transactIo, writeDurableTmp } from '@deepseek-ai/dsh-evolution-core'

// A genuinely alive foreign pid: the tests below need a LIVE holder that is NOT
// this process (F-367 recycles our own pid leftover, and F-366 sweeps our own
// pid tmp, so `process.pid` is no longer a valid "live foreign" fixture).
const liveChildren = new Set<ReturnType<typeof spawn>>()
function spawnLivePid(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  liveChildren.add(child)
  return child.pid!
}
afterAll(() => {
  for (const child of liveChildren) child.kill()
  liveChildren.clear()
})

it('nodeEvolutionIo.writeText serializes concurrent writers and cleans its lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-lock-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'shared.txt')
  await Promise.all(Array.from({ length: 8 }, (_, i) => io.writeText(target, `writer-${i}`)))
  // The file holds exactly one complete writer payload; the lock is released.
  const content = await readFile(target, 'utf8')
  expect(content).toMatch(/^writer-\d$/m)
  expect((await io.readText(`${target}.lock`))).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('nodeEvolutionIo.writeText takes over a stale lock (1s, E-8a) and still writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-stale-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'stale.txt')
  // A pid that cannot exist: the lock is stale AND holderless (rc.66 probe).
  await writeFile(`${target}.lock`, '999999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  expect((await io.readText(`${target}.lock`))).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('nodeEvolutionIo never steals a lock from a LIVE holder older than 1s (rc.66)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-live-lock-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'live.txt')
  // A real live FOREIGN pid (a spawned child): the probe must refuse the
  // takeover even though the lock looks stale by age. (`process.pid` would be
  // recycled as a F-367 leftover, so it cannot stand in for a foreign peer.)
  await writeFile(`${target}.lock`, String(spawnLivePid()), 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  await expect(io.writeText(target, 'fresh')).rejects.toThrow(/could not acquire write lock/)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  // The probe loop spends ~2s nominal (40 x 50ms retry budget); a loaded
  // machine crossed the default 5s cap in the full parallel run (0.3.28
  // release gate) — explicit budget so the retry loop owns the unbounded part.
}, 15_000)

it('nodeEvolutionIo takes over a stale lock from a GONE pid (rc.66)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-gone-lock-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'gone.txt')
  await writeFile(`${target}.lock`, '999999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('nodeEvolutionIo.transact runs read-modify-write atomically under one lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-transact-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'counter.json')
  const transact = io.transact
  expect(transact).toBeTypeOf('function')
  // Eight concurrent RMWs each bump a counter; a plain read+write loop would
  // lose updates, the transact must not.
  await Promise.all(Array.from({ length: 8 }, () => transact!(target, async (current) => {    const value = JSON.parse(current ?? '0') as number
    return JSON.stringify(value + 1)
  })))
  expect(await readFile(target, 'utf8')).toBe('8')
  expect((await io.readText(`${target}.lock`))).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('nodeEvolutionIo.transact deletes the file when task returns null', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-transact-del-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'remove-me.json')
  await io.writeText(target, 'keep')
  const transact = io.transact!
  await transact(target, async () => null)
  expect(await io.readText(target)).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('a task failure propagates immediately — it is never lock contention (E-8, 0.3.17)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-taskfail-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'ephemeral.json')
  let calls = 0
  const taskError = Object.assign(new Error('rename raced the writer'), { code: 'EPERM' })
  await expect(io.transact!(target, async () => {
    calls += 1
    throw taskError
  })).rejects.toThrow('rename raced the writer')
  // Executed ONCE — the old shape retried the task up to 40 times and ended
  // with the misleading "could not acquire write lock".
  expect(calls).toBe(1)
  // The lock was released on the failure path.
  expect(await io.readText(`${target}.lock`)).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('sweeps stale tmp files of dead writers on the next write (E-8b, 0.3.17)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-tmpsweep-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'sweep.json')
  const stale = `${target}.999999.abcd1234.tmp` // dead pid
  await writeFile(stale, 'leftover', 'utf8')
  const old = new Date(Date.now() - 7_200_000)
  await utimes(stale, old, old)
  await io.writeText(target, 'fresh')
  expect(await io.readText(stale)).toBeNull() // swept
  expect(await readFile(target, 'utf8')).toBe('fresh')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('does not sweep a fresh tmp from a live pid (E-8b, 0.3.17)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-tmpkeep-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'keep.json')
  // A FOREIGN live pid — a genuinely in-flight writer's tmp is kept. Our own
  // pid is now swept immediately (F-366), so it cannot stand in for a foreign
  // writer either.
  const fresh = `${target}.${spawnLivePid()}.abcd1234.tmp`
  await writeFile(fresh, 'in-flight', 'utf8')
  await io.writeText(target, 'fresh')
  expect(await io.readText(fresh)).toBe('in-flight') // kept (recent, live pid)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('nodeEvolutionIo.list reports ENOENT as empty (P2-4) and isSymlink probes the entry (G7)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-list-'))
  const io = nodeEvolutionIo()
  expect(await io.list(join(root, 'missing-dir'))).toEqual([])
  const target = join(root, 'real-file.txt')
  await io.writeText(target, 'x')
  expect(await io.isSymlink?.(target)).toBe(false)
  expect(await io.isSymlink?.(join(root, 'missing'))).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('two peers take over one stale dead lock without double-holding (F-101)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-dual-takeover-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'dual.json')
  // A stale lock from a dead pid is the takeover target for TWO peers at once.
  // The re-read-before-rm guard (F-101) must keep them serialized: each peer
  // re-reads the lock before deleting it and refuses to delete a lock a peer
  // has since acquired, so the RMWs never interleave (no double-hold).
  await writeFile(`${target}.lock`, '999999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  const transact = io.transact!
  await Promise.all(Array.from({ length: 2 }, () => transact(target, async (current) => {
    const value = JSON.parse(current ?? '0') as number
    return JSON.stringify(value + 1)
  })))
  expect(await readFile(target, 'utf8')).toBe('2')
  expect((await io.readText(`${target}.lock`))).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('self-heals a leftover lock carrying this process pid (F-367)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-selfheal-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'self.json')
  const lock = `${target}.lock`
  // A leftover lock naming OUR pid, whose failed release was recorded in
  // pendingSelfCleanup (with the body TOKEN — V8-05), is stale by definition —
  // the next write recycles it when the current body still matches.
  // (V4-05: without the pendingSelfCleanup registration an old same-pid lock
  // is treated as a live in-process task and deliberately NOT recycled.)
  pendingSelfCleanup.set(lock, String(process.pid))
  await writeFile(lock, String(process.pid), 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(lock, old, old)
  try {
    await io.writeText(target, 'fresh')
    expect(await readFile(target, 'utf8')).toBe('fresh')
    expect(await io.readText(lock)).toBeNull()
  } finally {
    pendingSelfCleanup.delete(lock)
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V8-05: a stale pendingSelfCleanup entry never removes a NEW same-pid lock (0.3.46)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-v805-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'v805.json')
  const lock = `${target}.lock`
  // The stale-entry hazard: a registered leftover was externally removed, and
  // another same-process writer created a FRESH lock at the path. The old
  // implementation compared two live reads and recycled it; V8-05 compares
  // the CURRENT body against the REGISTERED TOKEN from the failed release.
  pendingSelfCleanup.set(lock, 'old-token-body')
  await writeFile(lock, `${process.pid}:fresh-claim`, 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(lock, old, old)
  try {
    await expect(io.writeText(target, 'x')).rejects.toThrow()
    // The fresh lock survived — fail-loud instead of double-hold.
    expect(await io.readText(lock)).toBe(`${process.pid}:fresh-claim`)
  } finally {
    pendingSelfCleanup.delete(lock)
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}, 60_000)

it('does not steal a same-pid lock held by a long-running task (V4-05)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-live-samepid-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'live.json')
  const transact = io.transact!
  // The first RMW acquires the lock and holds it well past the 1s takeover
  // threshold — a genuinely in-flight same-process task.
  const first = transact(target, async () => {
    await new Promise(resolve => setTimeout(resolve, 1400))
    return 'v1'
  })
  // Ensure the first task owns the lock before the second writer starts.
  await new Promise(resolve => setTimeout(resolve, 60))
  // The second writer starts while the first is still holding. An mtime>1s
  // same-pid steal would rm the live lock and DOUBLE-EXECUTE (both think they
  // hold it, one increment is dropped). The fix waits instead: after the first
  // releases, the second reads its committed value and appends.
  const second = transact(target, async current => `${current ?? ''}|v2`)
  await Promise.all([first, second])
  expect(await readFile(target, 'utf8')).toBe('v1|v2')
  expect((await io.readText(`${target}.lock`))).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('takeover claims a stale dead lock atomically and leaves no residue (V4-04)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-atomic-takeover-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'atomic.json')
  await writeFile(`${target}.lock`, '999999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  // Six peers contend for one stale dead lock. The atomic rename takeover must
  // leave exactly one live claim (no double-hold) and no `.takeover-*` residue.
  const transact = io.transact!
  await Promise.all(Array.from({ length: 6 }, () => transact(target, async (current) => {
    const value = JSON.parse(current ?? '0') as number
    return JSON.stringify(value + 1)
  })))
  expect(await readFile(target, 'utf8')).toBe('6')
  expect(await io.readText(`${target}.lock`)).toBeNull()
  const entries = await readdir(root)
  expect(entries.filter(e => e.startsWith('atomic.json.takeover-'))).toEqual([])
  expect(entries.filter(e => e.endsWith('.lock'))).toEqual([])
  expect(entries).toEqual(['atomic.json'])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('ticket takeover survives 32-way contention on one dead lock — no lost RMW (V4-04 follow-up)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-ticket-takeover-'))
  // 240 attempts (~12s): under full-suite load the 32-way burst legitimately
  // exceeds the default ~2s budget; fail-loud only past a real stall.
  const io = nodeEvolutionIo(240)
  const target = join(root, 'ticket.json')
  await writeFile(`${target}.lock`, '999999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  // 32 peers contend for one stale dead lock. Before the ticket protocol the
  // probe→rename TOCTOU let multiple peers claim each other's mid-creation
  // locks (cascade double-hold: 32-way lost ~1-4 of 32 RMWs, 8-way 25%).
  // The ticket (`<lock>.next`, O_EXCL) makes the dead-lock removal single-
  // owner, so every claim is won by exactly one peer via the fair create.
  const transact = io.transact!
  await Promise.all(Array.from({ length: 32 }, () => transact(target, async (current) => {
    const value = JSON.parse(current ?? '0') as number
    return JSON.stringify(value + 1)
  })))
  expect(await readFile(target, 'utf8')).toBe('32')
  expect(await io.readText(`${target}.lock`)).toBeNull()
  const entries = await readdir(root)
  expect(entries.filter(e => e.startsWith('ticket.json.takeover-'))).toEqual([])
  expect(entries.filter(e => e.endsWith('.lock') || e.endsWith('.next'))).toEqual([])
  expect(entries).toEqual(['ticket.json'])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  // 32 serialized acquisitions take ~3-5s nominal; a loaded full-suite run
  // crossed the default 5s cap (0.3.28 follow-up gate) — explicit budget.
}, 15_000)

it('renameWithRetry recovers from a transient EPERM and still commits (F-366)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-renameretry-'))
  const src = join(root, 'src.txt')
  const dst = join(root, 'dst.txt')
  await writeFile(src, 'payload', 'utf8')
  let calls = 0
  // First rename fails with EPERM (the Windows "target temporarily held" case);
  // the retry then uses the real rename and must succeed.
  const flaky = async (from: string, to: string) => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    await rename(from, to)
  }
  await renameWithRetry(src, dst, flaky)
  expect(await readFile(dst, 'utf8')).toBe('payload')
  expect(calls).toBe(2) // initial + exactly one retry
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('renameWithRetry surfaces a non-retryable error immediately and gives up on persistent EPERM (C-28, C-28)', async () => {
  // A non-retryable code surfaces on the first attempt, never swallowed.
  await expect(renameWithRetry('src', 'dst', async () => {
    throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
  })).rejects.toThrow('EACCES')
  // Persistent EPERM/EBUSY exhausts the ~2s budget (6 backoff attempts:
  // 50+100+200+400+800+800ms) and rethrows WITH the C-28 diagnostic pointing
  // at the real causes — the original message stays greppable.
  let calls = 0
  await expect(renameWithRetry('src', 'dst', async () => {
    calls += 1
    throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
  })).rejects.toThrow(/EBUSY .*held by another process or marked read-only/)
  expect(calls).toBe(7) // initial + 6 backoff attempts
}, 15_000)

it('writeText deletes its tmp when the commit rename still fails (F-366)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-tmpclean-'))
  const io = nodeEvolutionIo()
  const dirTarget = join(root, 'a-directory')
  await mkdir(dirTarget, { recursive: true })
  // A directory squatting on the target makes the commit rename fail
  // deterministically; the current tmp must be deleted, not left for the
  // (1h + dead-pid) sweep. (On Windows the failure surfaces as EPERM, which
  // now runs the full C-28 ~2s rename budget before giving up — explicit
  // test budget for that.)
  await expect(io.writeText(dirTarget, 'x')).rejects.toThrow()
  const entries = await readdir(root)
  expect(entries.some(e => e.endsWith('.tmp'))).toBe(false)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}, 15_000)

it('sweeps this process own tmp immediately regardless of age (F-366)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-selfsweep-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'sweep.json')
  // Our own leftover tmp is recycled immediately (F-366) — a live writer's tmp
  // is a current write, not a crash artifact, so no 1h age gate applies.
  const fresh = `${target}.${process.pid}.abcd1234.tmp`
  await writeFile(fresh, 'in-flight', 'utf8')
  await io.writeText(target, 'fresh')
  expect(await io.readText(fresh)).toBeNull() // swept (self pid)
  expect(await readFile(target, 'utf8')).toBe('fresh')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('self-heals a 0-byte lock left by a crashed creator (V6-04, 0.3.35)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-emptylock-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'empty-lock.json')
  // A creator that died between open and write leaves a 0-byte lock whose body
  // never passes the pid probe — without the self-heal every future writer
  // fails loud after the retry budget, forever.
  await writeFile(`${target}.lock`, '', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  const entries = await readdir(root)
  expect(entries.filter(e => e.endsWith('.lock') || e.endsWith('.next'))).toEqual([])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('reclaims a 0-byte takeover ticket older than the takeover threshold (V6-04, 0.3.35)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-emptyticket-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'empty-ticket.json')
  await writeFile(`${target}.lock`, '999999', 'utf8')
  await writeFile(`${target}.lock.next`, '', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  await utimes(`${target}.lock.next`, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  const entries = await readdir(root)
  expect(entries.filter(e => e.endsWith('.lock') || e.endsWith('.next'))).toEqual([])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('sweeps a stale `.lock.next` ticket left by a crashed takeover (V6-18, 0.3.35)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-ticketsweep-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'ticket-sweep.json')
  // No lock present: the write acquires on the first attempt, so nothing in
  // the contention path ever sees the ticket — only the sweep can clean it.
  await writeFile(`${target}.lock.next`, '999999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock.next`, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  expect(await io.readText(`${target}.lock.next`)).toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('keeps a fresh live-pid ticket in the sweep (V6-18, 0.3.35)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-ticketkeep-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'ticket-keep.json')
  // A peer's in-flight takeover: a fresh ticket naming a LIVE pid is not a
  // crash artifact, so the sweep must leave it alone.
  await writeFile(`${target}.lock.next`, String(spawnLivePid()), 'utf8')
  await io.writeText(target, 'fresh')
  expect(await io.readText(`${target}.lock.next`)).not.toBeNull()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V5-03: a byte-identical transact does not touch the file mtime (direct regression, 0.3.29)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-noop-mtime-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'noop.json')
  await io.writeText(target, 'fixed')
  const before = (await stat(target)).mtimeMs
  await new Promise(resolve => setTimeout(resolve, 20))
  await io.transact!(target, async () => 'fixed')
  const after = (await stat(target)).mtimeMs
  expect(after).toBe(before)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V10-06 (P1-1): a failing tmp fsync fails loud, leaves no tmp, and never touches the target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-fsync-'))
  const target = join(root, 'durable.txt')
  await writeFile(target, 'precious', 'utf8')
  // Inject an open() whose handle syncs nothing: the real file is created and
  // written, but `handle.sync()` rejects — the crash-durable contract must
  // fail loud instead of committing un-fsynced bytes. (writeDurableTmp only
  // ever passes 'wx', so the fake fixes that flag.)
  const failingSyncOpen = (async (path: string) => {
    const handle = await open(path, 'wx')
    return {
      writeFile: (data: string) => handle.writeFile(data, 'utf8'),
      sync: () => Promise.reject(new Error('simulated sync failure')),
      close: () => handle.close(),
    }
  }) as unknown as typeof open
  await expect(writeDurableTmp(target, 'next', failingSyncOpen)).rejects.toThrow('simulated sync failure')
  // Fail-loud AND clean: no tmp leaked, the target bytes untouched.
  const entries = await readdir(root)
  expect(entries.some(name => name.endsWith('.tmp'))).toBe(false)
  expect(await readFile(target, 'utf8')).toBe('precious')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V10-06 (P1-1): a durable writeText still sweeps stale tmps and leaves no residue behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-durable-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'durable.txt')
  // A crashed writer's tmp (dead pid, old) is still swept on the next write;
  // the durable write itself leaves exactly the target behind.
  const stale = `${target}.999999.abcd1234.tmp`
  await writeFile(stale, 'leftover', 'utf8')
  const old = new Date(Date.now() - 7_200_000)
  await utimes(stale, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  expect(await io.readText(stale)).toBeNull()
  expect(await readdir(root)).toEqual(['durable.txt'])
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V10-07 (P2-1): a torn lock body is refused while fresh, then taken over past the 1h threshold (warned once)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-tornlock-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'torn.json')
  // A torn body: non-empty, pid prefix unparseable (NaN) — it matched neither
  // the dead-pid nor the empty-body takeover, so every future writer failed
  // loud forever (sweepStaleTmps deliberately skips `.lock`).
  await writeFile(`${target}.lock`, 'ab:cd1234', 'utf8')
  await expect(io.writeText(target, 'fresh')).rejects.toThrow(/could not acquire write lock/)
  // Still stuck while the lock is far below the 1h tear threshold.
  await expect(io.writeText(target, 'fresh')).rejects.toThrow(/could not acquire write lock/)
  // Age past the 1h threshold: the takeover fires (warned exactly once) and
  // the write recovers; the lock is released normally afterwards.
  const warns: string[] = []
  const originalWarn = console.warn
  console.warn = (message?: unknown) => { warns.push(String(message)) }
  try {
    const torn = new Date(Date.now() - 3_600_000 - 60_000)
    await utimes(`${target}.lock`, torn, torn)
    await io.writeText(target, 'fresh')
    expect(await readFile(target, 'utf8')).toBe('fresh')
    expect(await io.readText(`${target}.lock`)).toBeNull()
    expect(warns).toHaveLength(1)
    expect(warns.join('\n')).toMatch(/corrupt write lock/)
  } finally {
    console.warn = originalWarn
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  // Two ~2s refused-acquisition budgets dominate the runtime.
}, 20_000)

it('S-10: a `.corrupt` quarantine copy older than 7 days is swept by the next write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-corruptsweep-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'state.json')
  await writeFile(`${target}.corrupt`, '{"broken"', 'utf8')
  const stale = new Date(Date.now() - 8 * 24 * 3_600_000)
  await utimes(`${target}.corrupt`, stale, stale)
  await io.writeText(target, 'fresh')
  expect(await io.readText(`${target}.corrupt`)).toBeNull() // swept
  expect(await readFile(target, 'utf8')).toBe('fresh')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('S-10: a `.corrupt` copy inside the 7-day rescue window is kept', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-corruptkeep-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'state.json')
  const content = '{"broken": true}'
  await writeFile(`${target}.corrupt`, content, 'utf8')
  const recent = new Date(Date.now() - 24 * 3_600_000)
  await utimes(`${target}.corrupt`, recent, recent)
  await io.writeText(target, 'fresh')
  // Still inside the operator rescue window — untouched.
  expect(await io.readText(`${target}.corrupt`)).toBe(content)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('C-07: the transact-less fallback skips the write on a byte-identical result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-fallback-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'fallback.json')
  await io.writeText(target, 'fixed')
  const before = (await stat(target)).mtimeMs
  await new Promise(resolve => setTimeout(resolve, 20))
  // Strip the backend transact: the fallback path (read → task → write) must
  // short-circuit when the task returns the same bytes — the same V5-03
  // no-op rule the node backend already applies (C-07 asymmetry).
  const fallback = { ...io }
  delete (fallback as { transact?: unknown }).transact
  await transactIo(fallback, target, async () => 'fixed')
  expect((await stat(target)).mtimeMs).toBe(before)
  // A changed result still writes through the fallback.
  await transactIo(fallback, target, async () => 'changed')
  expect(await readFile(target, 'utf8')).toBe('changed')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
