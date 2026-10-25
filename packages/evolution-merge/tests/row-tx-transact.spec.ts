// @tier pre-tag
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mergeStatePath } from '../src/state.ts'
import { pairLedger } from '../src/domain/pair-ledger.ts'
import { makeV4Home } from './support/schema4-home.ts'

const verify = { id: 'r', pairKey: 'a|b', a: 'a', b: 'b', version: 0, createdAt: 'c', updatedAt: 'c', origin: 'agent' as const, state: 'verify' as const, verifySubState: 'unverified' as const, attempts: 0 }
const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }

it('creates and transitions inside one v4 transaction', async () => {
  const { home, io } = await makeV4Home([])
  const pending = await pairLedger(io, home).transact(tx => {
    expect(tx.createVerify(verify).ok).toBe(true)
    const moved = tx.transition('r', { type: 'verify-passed', decision, target: 'a' }, 0)
    expect(moved.ok).toBe(true)
    return moved
  })
  expect(pending.ok).toBe(true)
  if (pending.ok) expect(pending.row).toMatchObject({ state: 'pending', version: 1 })
  const raw = JSON.parse(await readFile(mergeStatePath(home), 'utf8'))
  expect(raw.schemaVersion).toBe(4)
  expect(raw.rows[0].version).toBe(1)
})

it('serializes two writers and rejects the stale version', async () => {
  const { home, io } = await makeV4Home([])
  await pairLedger(io, home).transact(tx => tx.createVerify(verify))
  const run = () => pairLedger(io, home).transact(tx => tx.transition('r', { type: 'superseded' }, 0))
  const [a, b] = await Promise.all([run(), run()])
  expect([a.ok, b.ok].sort()).toEqual([false, true])
  expect((await pairLedger(io, home).transact(tx => tx.rows())).length).toBe(0)
})

it('removes only through a terminal v4 event', async () => {
  const { home, io } = await makeV4Home([])
  await pairLedger(io, home).transact(tx => tx.createVerify(verify))
  const removed = await pairLedger(io, home).transact(tx => tx.remove('r', 'superseded', undefined, 0))
  expect(removed.ok).toBe(true)
  expect(await pairLedger(io, home).transact(tx => tx.rows())).toEqual([])
})

it('refuses invalid v4 rows without touching the file', async () => {
  const home = await tempRoot('dsh-row-tx-bad-')
  const io = nodeEvolutionIo()
  const { writeFile, mkdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  await mkdir(join(home, 'merge'), { recursive: true })
  const bytes = JSON.stringify({ schemaVersion: 4, rows: [{ id: 'x' }] })
  await writeFile(mergeStatePath(home), bytes)
  const before = await readFile(mergeStatePath(home), 'utf8')
  await expect(pairLedger(io, home).transact(tx => tx.rows())).rejects.toThrow()
  expect(await readFile(mergeStatePath(home), 'utf8')).toBe(before)
})
