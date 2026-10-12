import { afterAll, expect, it, vi } from 'vitest'
// Contention tests spawn real fs races; full-suite parallel load can stretch
// them far beyond the vitest default (audit v10 integration fix).
vi.setConfig({ testTimeout: 30_000 })
// V27 G7.2 LOAD-SENSITIVE GROUP: the cases that decide by a lock TIMING or
// LIVENESS threshold are listed in `scripts/run-load-sensitive.mjs` (3 entries,
// each with its reason) and are run there ONCE at a pinned worker count — so a
// green result is a green at a known concurrency instead of an accident of the
// default one. Renaming a case means updating its entry in that list: the runner
// asserts the matched count, so a silent drop-out fails the gate.
import { chmod, mkdir, readdir, rename, stat, writeFile, readFile, utimes, open } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { nodeEvolutionIo, renameWithRetry, transactIo, writeDurableTmp } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

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

it('nodeEvolutionIo.writeText commits one complete payload per concurrent writer', async () => {
  // v32 TEST-04: a blind `writeText` cannot prove SERIALIZATION (atomic rename
  // alone yields one complete payload even without any lock). This case pins
  // atomicity; the serialization invariant is pinned by the `transact` RMW
  // counter cases below (which would fail on a lost update). The old title also
  // promised lock cleanup — an assertion that could no longer fail once the lock
  // protocol was retired, so it was deleted rather than kept green (P2-7).
  const root = await tempRoot('dsh-io-lock-')
  const io = nodeEvolutionIo()
  const target = join(root, 'shared.txt')
  await Promise.all(Array.from({ length: 8 }, (_, i) => io.writeText(target, `writer-${i}`)))
  // The file holds exactly one complete writer payload.
  const content = await readFile(target, 'utf8')
  expect(content).toMatch(/^writer-\d$/m)
})

// v32 TEST-03: the commit-point ownership guard. A foreign claim landing on
// the commit point and the whole RMW must be REDONE — this is the load-independent
// invariant that keeps concurrent writes loss-free (the class that broke as
// EVO-IO-01). The retired lock protocol's own guard (`assertOwned`) named in the
// old comment is gone with it; what remains is the counter that loses an update
// if the RMW is not atomic.
it('nodeEvolutionIo.transact runs read-modify-write atomically under one lock', async () => {
  const root = await tempRoot('dsh-io-transact-')
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
})

it('nodeEvolutionIo.transact deletes the file when task returns null', async () => {
  const root = await tempRoot('dsh-io-transact-del-')
  const io = nodeEvolutionIo()
  const target = join(root, 'remove-me.json')
  await io.writeText(target, 'keep')
  const transact = io.transact!
  await transact(target, async () => null)
  expect(await io.readText(target)).toBeNull()
})

it('a task failure propagates immediately — it is never lock contention (E-8, 0.3.17)', async () => {
  const root = await tempRoot('dsh-io-taskfail-')
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
})

it('sweeps stale tmp files of dead writers on the next write (E-8b, 0.3.17)', async () => {
  const root = await tempRoot('dsh-io-tmpsweep-')
  const io = nodeEvolutionIo()
  const target = join(root, 'sweep.json')
  const stale = `${target}.999999.abcd1234.tmp` // dead pid
  await writeFile(stale, 'leftover', 'utf8')
  const old = new Date(Date.now() - 7_200_000)
  await utimes(stale, old, old)
  await io.writeText(target, 'fresh')
  expect(await io.readText(stale)).toBeNull() // swept
  expect(await readFile(target, 'utf8')).toBe('fresh')
})

it('does not sweep a fresh tmp from a live pid (E-8b, 0.3.17)', async () => {
  const root = await tempRoot('dsh-io-tmpkeep-')
  const io = nodeEvolutionIo()
  const target = join(root, 'keep.json')
  // A FOREIGN live pid — a genuinely in-flight writer's tmp is kept. Our own
  // pid is now swept immediately (F-366), so it cannot stand in for a foreign
  // writer either.
  const fresh = `${target}.${spawnLivePid()}.abcd1234.tmp`
  await writeFile(fresh, 'in-flight', 'utf8')
  await io.writeText(target, 'fresh')
  expect(await io.readText(fresh)).toBe('in-flight') // kept (recent, live pid)
})

it('nodeEvolutionIo.list reports ENOENT as empty (P2-4) and isSymlink probes the entry (G7)', async () => {
  const root = await tempRoot('dsh-io-list-')
  const io = nodeEvolutionIo()
  expect(await io.list(join(root, 'missing-dir'))).toEqual([])
  const target = join(root, 'real-file.txt')
  await io.writeText(target, 'x')
  expect(await io.isSymlink?.(target)).toBe(false)
  expect(await io.isSymlink?.(join(root, 'missing'))).toBeNull()
})

it('V27 G1.4: the quarantine sweep covers every historical copy shape and spares user files', async () => {
  const root = await tempRoot('dsh-io-corrupt-sweep-')
  const io = nodeEvolutionIo()
  const target = join(root, 'state.json')
  const stale = new Date(Date.now() - 8 * 86_400_000)
  const shapes = [
    'state.json.corrupt', // current fixed name
    'state.json.corrupt.1700000000000', // stamped variant
    'state.json.corrupt-1700000000000-ab12cd', // v10-05 legacy series
  ]
  for (const name of shapes) {
    await writeFile(join(root, name), '{}', 'utf8')
    await utimes(join(root, name), stale, stale)
  }
  // A user support file that merely CONTAINS `.corrupt` and ends in `.md` must
  // survive: the namespace reserves names ENDING in `.corrupt`.
  await writeFile(join(root, 'overview.md.corrupt-backup.md'), '# notes', 'utf8')
  await utimes(join(root, 'overview.md.corrupt-backup.md'), stale, stale)
  // Any write to the directory runs the sweep (it is lazy, inside the lock).
  await io.writeText(target, '{}')
  const left = (await readdir(root)).sort()
  for (const name of shapes) expect(left).not.toContain(name)
  expect(left).toContain('overview.md.corrupt-backup.md')
  expect(left).toContain('state.json')
})

it('renameWithRetry recovers from a transient EPERM and still commits (F-366)', async () => {
  const root = await tempRoot('dsh-io-renameretry-')
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
  const root = await tempRoot('dsh-io-tmpclean-')
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
}, 15_000)

it('sweeps this process own tmp immediately regardless of age (F-366)', async () => {
  const root = await tempRoot('dsh-io-selfsweep-')
  const io = nodeEvolutionIo()
  const target = join(root, 'sweep.json')
  // Our own leftover tmp is recycled immediately (F-366) — a live writer's tmp
  // is a current write, not a crash artifact, so no 1h age gate applies.
  const fresh = `${target}.${process.pid}.abcd1234.tmp`
  await writeFile(fresh, 'in-flight', 'utf8')
  await io.writeText(target, 'fresh')
  expect(await io.readText(fresh)).toBeNull() // swept (self pid)
  expect(await readFile(target, 'utf8')).toBe('fresh')
})

it('V5-03: a byte-identical transact does not touch the file mtime (direct regression, 0.3.29)', async () => {
  const root = await tempRoot('dsh-io-noop-mtime-')
  const io = nodeEvolutionIo()
  const target = join(root, 'noop.json')
  await io.writeText(target, 'fixed')
  const before = (await stat(target)).mtimeMs
  await new Promise(resolve => setTimeout(resolve, 20))
  await io.transact!(target, async () => 'fixed')
  const after = (await stat(target)).mtimeMs
  expect(after).toBe(before)
})

it('V10-06 (P1-1): a failing tmp fsync fails loud, leaves no tmp, and never touches the target', async () => {
  const root = await tempRoot('dsh-io-fsync-')
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
})

it('V10-06 (P1-1): a durable writeText still sweeps stale tmps and leaves no residue behind', async () => {
  const root = await tempRoot('dsh-io-durable-')
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
})

it('S-10: a `.corrupt` quarantine copy older than 7 days is swept by the next write', async () => {
  const root = await tempRoot('dsh-io-corruptsweep-')
  const io = nodeEvolutionIo()
  const target = join(root, 'state.json')
  await writeFile(`${target}.corrupt`, '{"broken"', 'utf8')
  const stale = new Date(Date.now() - 8 * 24 * 3_600_000)
  await utimes(`${target}.corrupt`, stale, stale)
  await io.writeText(target, 'fresh')
  expect(await io.readText(`${target}.corrupt`)).toBeNull() // swept
  expect(await readFile(target, 'utf8')).toBe('fresh')
})

it('S-10: a `.corrupt` copy inside the 7-day rescue window is kept', async () => {
  const root = await tempRoot('dsh-io-corruptkeep-')
  const io = nodeEvolutionIo()
  const target = join(root, 'state.json')
  const content = '{"broken": true}'
  await writeFile(`${target}.corrupt`, content, 'utf8')
  const recent = new Date(Date.now() - 24 * 3_600_000)
  await utimes(`${target}.corrupt`, recent, recent)
  await io.writeText(target, 'fresh')
  // Still inside the operator rescue window — untouched.
  expect(await io.readText(`${target}.corrupt`)).toBe(content)
})

it('C-07: the transact-less fallback skips the write on a byte-identical result', async () => {
  const root = await tempRoot('dsh-io-fallback-')
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
})

it('V27 G1.3: a committed-but-unfsynced write is success-with-warning, not a rejection', async () => {
  const committed = Object.assign(new Error('commitTmp: renamed but the directory fsync failed'), { committed: true })
  // The transact backend reports a post-rename fsync failure: the bytes ARE on
  // disk, so the RMW must resolve (every durable consumer funnels through this
  // helper — propagating made them report "not written" for a landed write).
  const warns: string[] = []
  const originalWarn = console.warn
  console.warn = (message?: unknown) => { warns.push(String(message)) }
  try {
    await transactIo(
      {
        async readText() { return null },
        async writeText() {},
        // Only `transact` participates in this test; the remaining seam members
        // are unreachable here and fail loud if that assumption ever breaks.
        async remove() { throw new Error('unreachable: remove') },
        async list() { throw new Error('unreachable: list') },
        async exists() { throw new Error('unreachable: exists') },
        async rename() { throw new Error('unreachable: rename') },
        async copy() { throw new Error('unreachable: copy') },
        async transact() { throw committed },
      },
      '/tmp/whatever',
      async () => 'next',
    )
    expect(warns.some(line => line.includes('durability is unconfirmed'))).toBe(true)
    // A real failure still propagates.
    await expect(transactIo(
      {
        async readText() { return null },
        async writeText() {},
        async remove() { throw new Error('unreachable: remove') },
        async list() { throw new Error('unreachable: list') },
        async exists() { throw new Error('unreachable: exists') },
        async rename() { throw new Error('unreachable: rename') },
        async copy() { throw new Error('unreachable: copy') },
        async transact() { throw new Error('disk on fire') },
      },
      '/tmp/whatever',
      async () => 'next',
    )).rejects.toThrow('disk on fire')
  } finally {
    console.warn = originalWarn
  }
})

it('P3-8 (v14): isSymlink returns null only for a missing path and propagates a real lstat failure', async () => {
  const root = await tempRoot('dsh-io-symlink-')
  const io = nodeEvolutionIo()
  // Missing path = "guard not applicable".
  expect(await io.isSymlink!(join(root, 'nope'))).toBeNull()
  await writeFile(join(root, 'plain.txt'), 'x')
  expect(await io.isSymlink!(join(root, 'plain.txt'))).toBe(false)
  // A genuine lstat failure must NOT read as "not a symlink": an invalid path
  // throws ERR_INVALID_ARG_VALUE, which the old blanket catch swallowed.
  await expect(io.isSymlink!('bad\0path')).rejects.toThrow()
})

it('P3-9 (v14): an atomic rewrite preserves a tightened file mode (POSIX)', async () => {
  if (process.platform === 'win32') return
  const root = await tempRoot('dsh-io-mode-')
  const io = nodeEvolutionIo()
  const target = join(root, 'secret.txt')
  await io.writeText(target, 'first')
  await chmod(target, 0o600)
  await io.writeText(target, 'second')
  expect((await stat(target)).mode & 0o777).toBe(0o600)
  expect(await readFile(target, 'utf8')).toBe('second')
})

it('G2 S4: concurrent RMW on ONE path inside this process never loses an update', async () => {
  const root = await tempRoot('dsh-io-serial-')
  const io = nodeEvolutionIo()
  const target = join(root, 'counter.txt')
  await io.writeText(target, '0')
  // The surviving concurrency guarantee: one promise chain per path, so twelve readers all see
  // the previous write. (Cross-process mutual exclusion is the platform provider's job now.)
  await Promise.all(Array.from({ length: 12 }, () => io.transact(target, async current => String(Number(current ?? '0') + 1))))
  expect(await io.readText(target)).toBe('12')
})

it('G2 S4: a `*.lock` file is inert data — writes ignore it and it is never swept', async () => {
  const root = await tempRoot('dsh-io-lockinert-')
  const io = nodeEvolutionIo()
  const target = join(root, 'state.json')
  await writeFile(`${target}.lock`, `${process.pid}:deadbeef`, 'utf8')
  await io.writeText(target, 'fresh')
  await io.transact(target, async () => 'next')
  expect(await io.readText(target)).toBe('next')
  // It is the user's bytes, not a protocol artifact: writes neither obey nor delete it.
  expect(await io.readText(`${target}.lock`)).toBe(`${process.pid}:deadbeef`)
})
