import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'

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
  // The current process is alive: the probe must refuse the takeover even
  // though the lock looks stale by age.
  await writeFile(`${target}.lock`, String(process.pid), 'utf8')
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
  await expect(io.transact(target, async () => {
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
  const fresh = `${target}.${process.pid}.abcd1234.tmp`
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
