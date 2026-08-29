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
  await writeFile(`${target}.lock`, '9999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${target}.lock`, old, old)
  await io.writeText(target, 'fresh')
  expect(await readFile(target, 'utf8')).toBe('fresh')
  expect((await io.readText(`${target}.lock`))).toBeNull()
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
