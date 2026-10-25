// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { loadMergeState, mergeStatePath, pairKey, rowIdOf, dropRow, moveRow, mutateMergeState, upsertRow } from '../src/index.ts'
import { pairLedger } from '../src/domain/pair-ledger.ts'
import { makeV4Home } from './support/schema4-home.ts'

const AT = '2026-10-20T00:00:00.000Z'
const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }

it('derives a stable row id from the pair key', () => {
  expect(rowIdOf('a\u0000b')).toMatch(/^mr_[0-9a-z]+$/)
  expect(rowIdOf('a\u0000b')).toBe(rowIdOf('a\u0000b'))
  expect(rowIdOf('a\u0000b')).not.toBe(rowIdOf('a\u0000c'))
})

it('creates, transitions and removes a row through PairLedger', async () => {
  const { home, io } = await makeV4Home([])
  const key = pairKey('a', 'b')
  const created = await pairLedger(io, home).transact(tx => tx.createVerify({ id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'verify', verifySubState: 'unverified', version: 0, createdAt: AT, updatedAt: AT, origin: 'agent', attempts: 0 }))
  expect(created.ok).toBe(true)
  const pending = await pairLedger(io, home).transact(tx => tx.transition(rowIdOf(key), { type: 'verify-passed', decision, target: 'a' }, 0))
  expect(pending.ok).toBe(true)
  expect((await loadMergeState(io, home)).state.rows[0]).toMatchObject({ state: 'pending', queue: 'pending' })
  const removed = await pairLedger(io, home).transact(tx => tx.remove(rowIdOf(key), 'superseded', undefined, 1))
  expect(removed.ok).toBe(true)
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
})

it('uses RowTx version CAS instead of a second writer', async () => {
  const { home, io } = await makeV4Home([])
  const key = pairKey('a', 'b')
  await pairLedger(io, home).transact(tx => tx.createVerify({ id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'verify', verifySubState: 'unverified', version: 0, createdAt: AT, updatedAt: AT, origin: 'agent', attempts: 0 }))
  const one = await pairLedger(io, home).transact(tx => tx.transition(rowIdOf(key), { type: 'verify-passed', decision, target: 'a' }, 0))
  expect(one.ok).toBe(true)
  const stale = await pairLedger(io, home).transact(tx => tx.transition(rowIdOf(key), { type: 'skipped', reason: 'stale' }, 0))
  expect(stale).toMatchObject({ ok: false, code: 'version-conflict' })
})

it('reads without writing and normalizes a queue from state', async () => {
  const home = await tempRoot('dsh-merge-state-read-')
  const base = nodeEvolutionIo()
  let writes = 0
  const io = { ...base, writeText: async (path: string, content: string) => { writes += 1; await base.writeText(path, content) }, remove: async (path: string) => { writes += 1; await base.remove(path) } }
  await base.writeText(mergeStatePath(home), JSON.stringify({ schemaVersion: 1, rows: [{ id: 'r', pairKey: 'a\u0000b', a: 'a', b: 'b', state: 'pending', createdAt: AT, updatedAt: AT }, { id: 'bad' }] }, null, 2))
  const before = writes
  const loaded = await loadMergeState(io, home)
  expect(writes).toBe(before)
  expect(loaded.state.rows).toHaveLength(1)
  expect(loaded.state.rows[0]).toMatchObject({ state: 'pending', queue: 'pending' })
  expect(loaded.note).toContain('invalid row')
})

it('rejects every legacy writer', async () => {
  const home = await tempRoot('dsh-merge-legacy-')
  const io = nodeEvolutionIo()
  const first = { id: 'r', pairKey: 'a', a: 'a', b: 'b', state: 'verify' as const, queue: 'verify' as const, createdAt: AT, updatedAt: AT }
  await expect(mutateMergeState(io, home, () => 1, () => ({ rows: [], result: null }))).rejects.toThrow('legacy-writer-removed')
  await expect(upsertRow(io, home, () => 1, first)).rejects.toThrow('legacy-writer-removed')
  await expect(dropRow(io, home, () => 1, first.id)).rejects.toThrow('legacy-writer-removed')
  await expect(moveRow(io, home, () => 1, first.id, { queue: 'pending' })).rejects.toThrow('legacy-writer-removed')
})
