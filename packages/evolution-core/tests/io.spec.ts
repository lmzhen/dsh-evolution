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
