// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import {
  dropRow,
  loadMergeState,
  mergeStatePath,
  moveRow,
  pairKey,
  rowIdOf,
  upsertRow,
  type MergeRow,
} from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const now = () => Date.parse(AT)

function row(a: string, b: string): MergeRow {
  const key = pairKey(a, b)
  return {
    id: rowIdOf(key),
    pairKey: key,
    a,
    b,
    state: 'verify',
    queue: 'verify',
    createdAt: AT,
    updatedAt: AT,
  }
}

it('derives a stable row id from the pair key', () => {
  expect(rowIdOf('a\u0000b')).toMatch(/^mr_[0-9a-z]+$/)
  expect(rowIdOf('a\u0000b')).toBe(rowIdOf('a\u0000b'))
  expect(rowIdOf('a\u0000b')).not.toBe(rowIdOf('a\u0000c'))
})

it('upserts, moves and drops a row through one ledger', async () => {
  const home = await tempRoot('dsh-merge-state-')
  const io = nodeEvolutionIo()
  const first = row('a', 'b')
  await upsertRow(io, home, now, first)
  let loaded = await loadMergeState(io, home)
  expect(loaded.ok).toBe(true)
  expect(loaded.state.rows).toHaveLength(1)
  expect(loaded.state.rows[0]).toMatchObject({ id: first.id, pairKey: first.pairKey, state: 'verify', queue: 'verify' })

  const moved = await moveRow(io, home, now, first.id, { queue: 'pending', state: 'pending' })
  expect(moved).toMatchObject({ state: 'pending', queue: 'pending' })
  loaded = await loadMergeState(io, home)
  expect(loaded.state.rows[0]).toMatchObject({ state: 'pending', queue: 'pending' })

  expect(await dropRow(io, home, now, first.id)).toBe(true)
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
  expect(await dropRow(io, home, now, first.id)).toBe(false)
})

it('reads without writing and normalizes a queue from state', async () => {
  const home = await tempRoot('dsh-merge-state-read-')
  const base = nodeEvolutionIo()
  let writes = 0
  const io = {
    ...base,
    writeText: async (path: string, content: string) => { writes += 1; await base.writeText(path, content) },
    remove: async (path: string) => { writes += 1; await base.remove(path) },
  }
  await base.writeText(mergeStatePath(home), JSON.stringify({
    schemaVersion: 1,
    rows: [
      { ...row('a', 'b'), state: 'pending', queue: 'skipped' },
      { id: 'bad' },
    ],
  }, null, 2))
  const before = writes
  const loaded = await loadMergeState(io, home)
  expect(writes).toBe(before)
  expect(loaded.state.rows).toHaveLength(1)
  expect(loaded.state.rows[0]).toMatchObject({ state: 'pending', queue: 'pending' })
  expect(loaded.note).toContain('invalid row')
  expect(typeof base.readText).toBe('function')
})
