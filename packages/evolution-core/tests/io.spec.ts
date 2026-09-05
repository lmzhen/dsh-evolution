import { afterAll, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile, readFile, utimes } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeEvolutionIo, renameWithRetry } from '@deepseek-ai/dsh-evolution-core'

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
  await rm(root, { recursive: true, force: true })
})

it('nodeEvolutionIo.writeText takes over a stale lock (5s) and still writes', async () => {
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
  await rm(root, { recursive: true, force: true })
})

it('nodeEvolutionIo never steals a lock from a LIVE holder older than 5s (rc.66)', async () => {
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
  await rm(root, { recursive: true, force: true })
})

it('nodeEvolutionIo takes over a stale lock from a GONE pid (rc.66)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-gone-lock-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'gone.txt')
  await writeFile(`${target}.lock`, '999999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
})

it('nodeEvolutionIo.transact deletes the file when task returns null', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-transact-del-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'remove-me.json')
  await io.writeText(target, 'keep')
  const transact = io.transact!
  await transact(target, async () => null)
  expect(await io.readText(target)).toBeNull()
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
})

it('nodeEvolutionIo.list reports ENOENT as empty (P2-4) and isSymlink probes the entry (G7)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-list-'))
  const io = nodeEvolutionIo()
  expect(await io.list(join(root, 'missing-dir'))).toEqual([])
  const target = join(root, 'real-file.txt')
  await io.writeText(target, 'x')
  expect(await io.isSymlink?.(target)).toBe(false)
  expect(await io.isSymlink?.(join(root, 'missing'))).toBeNull()
  await rm(root, { recursive: true, force: true })
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
  await rm(root, { recursive: true, force: true })
})

it('self-heals a stale lock carrying this process pid (F-367)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-selfheal-'))
  const io = nodeEvolutionIo()
  const target = join(root, 'self.json')
  // A leftover lock naming OUR pid (a failed release or a crash) is a stale
  // leftover, not a live holder — the next write recycles it and succeeds.
  await writeFile(`${target}.lock`, String(process.pid), 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  expect((await io.readText(`${target}.lock`))).toBeNull()
  await rm(root, { recursive: true, force: true })
})

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
  await rm(root, { recursive: true, force: true })
})

it('renameWithRetry surfaces a non-retryable error immediately and gives up on persistent EPERM', async () => {
  // A non-retryable code surfaces on the first attempt, never swallowed.
  await expect(renameWithRetry('src', 'dst', async () => {
    throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
  })).rejects.toThrow('EACCES')
  // Persistent EPERM/EBUSY exhausts the 3-retry budget (~150ms) and rethrows.
  let calls = 0
  await expect(renameWithRetry('src', 'dst', async () => {
    calls += 1
    throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
  })).rejects.toThrow('EBUSY')
  expect(calls).toBe(4) // initial + 3 retries
})

it('writeText deletes its tmp when the commit rename still fails (F-366)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-io-tmpclean-'))
  const io = nodeEvolutionIo()
  const dirTarget = join(root, 'a-directory')
  await mkdir(dirTarget, { recursive: true })
  // A directory squatting on the target makes the commit rename fail
  // deterministically; the current tmp must be deleted, not left for the
  // (1h + dead-pid) sweep.
  await expect(io.writeText(dirTarget, 'x')).rejects.toThrow()
  const entries = await readdir(root)
  expect(entries.some(e => e.endsWith('.tmp'))).toBe(false)
  await rm(root, { recursive: true, force: true })
})

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
  await rm(root, { recursive: true, force: true })
})
