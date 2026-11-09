// @tier fast
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertHomeOwner } from '../src/home-owner.ts'
import { nodeEvolutionIo } from '../src/io.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

it('claims a home for this process and permits the same owner again', async () => {
  const home = await tempRoot('dsh-home-owner-')
  const io = nodeEvolutionIo()
  await assertHomeOwner(io, home)
  await assertHomeOwner(io, home)
  const raw = JSON.parse(await readFile(join(home, '.evolution-owner.json'), 'utf8')) as { pid: number }
  expect(raw.pid).toBe(process.pid)
})

it('refuses a home owned by another live process', async () => {
  const home = await tempRoot('dsh-home-owner-live-')
  const io = nodeEvolutionIo()
  await io.writeText(join(home, '.evolution-owner.json'), JSON.stringify({ pid: process.ppid, startedAt: 'x' }))
  await expect(assertHomeOwner(io, home)).rejects.toThrow('single-host')
})

it('takes over a stale owner record', async () => {
  const home = await tempRoot('dsh-home-owner-stale-')
  const io = nodeEvolutionIo()
  await io.writeText(join(home, '.evolution-owner.json'), JSON.stringify({ pid: 99999999, startedAt: 'x' }))
  await assertHomeOwner(io, home)
})
