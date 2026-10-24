// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { dropRowV3, mergeStatePath, transactRows } from '../src/state.ts'
import type { VerifyRowV3 } from '../src/domain/row-v3.ts'

const verify: VerifyRowV3 = { id: 'r', pairKey: 'a|b', a: 'a', b: 'b', version: 0, createdAt: 'c', updatedAt: 'c', origin: 'agent', state: 'verify', verifySubState: 'unverified', attempts: 0 }
const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }

it('creates and transitions inside one v3 transaction', async () => {
  const home = await tempRoot('dsh-row-tx-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [] }))
  const pending = await transactRows(io, home, tx => {
    expect(tx.createVerify(verify).ok).toBe(true)
    const moved = tx.transition('r', { type: 'verify-passed', decision, target: 'a' }, 0)
    expect(moved.ok).toBe(true)
    return moved
  })
  expect(pending.ok).toBe(true)
  if (pending.ok) expect(pending.row).toMatchObject({ state: 'pending', version: 1 })
  const raw = JSON.parse(await readFile(mergeStatePath(home), 'utf8'))
  expect(raw.schemaVersion).toBe(3)
  expect(raw.rows[0].version).toBe(1)
})

it('serializes two writers and rejects the stale version', async () => {
  const home = await tempRoot('dsh-row-tx-cas-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [verify] }))
  const run = () => transactRows(io, home, tx => tx.transition('r', { type: 'superseded' }, 0))
  const [a, b] = await Promise.all([run(), run()])
  expect([a.ok, b.ok].sort()).toEqual([false, true])
  expect((await transactRows(io, home, tx => tx.rows()))[0]?.version ?? null).toBe(null)
})

it('drops only through a terminal v3 event', async () => {
  const home = await tempRoot('dsh-row-tx-drop-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [verify] }))
  expect(await dropRowV3(io, home, 'r', 'superseded')).toBe(true)
  expect(await transactRows(io, home, tx => tx.rows())).toEqual([])
})

it('rejects v2 and invalid v3 without writing', async () => {
  const home = await tempRoot('dsh-row-tx-bad-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const v2 = JSON.stringify({ schemaVersion: 2, rows: [] })
  await writeFile(mergeStatePath(home), v2)
  await expect(transactRows(io, home, () => 1)).rejects.toThrow('merge-state-migration-required')
  expect(createHash('sha256').update(await readFile(mergeStatePath(home))).digest('hex')).toBe(createHash('sha256').update(v2).digest('hex'))
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [{ id: 'x' }] }))
  await expect(transactRows(io, home, () => 1)).rejects.toThrow('merge-state-needs-repair')
})
