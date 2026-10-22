// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { approvePending, loadMergeState, pairKey, rejectPending, rowIdOf, upsertRow, type MergeRow } from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'

async function pending(home: string): Promise<MergeRow> {
  const key = pairKey('a', 'b')
  const row: MergeRow = { id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'pending', queue: 'pending', createdAt: AT, updatedAt: AT }
  await upsertRow(nodeEvolutionIo(), home, () => Date.parse(AT), row)
  return row
}

it('approves one pending row and rejects a second action', async () => {
  const home = await tempRoot('dsh-merge-pending-approve-')
  const io = nodeEvolutionIo()
  const row = await pending(home)
  const approved = await approvePending(io, home, () => Date.parse(AT), row.id)
  expect(approved).toMatchObject({ ok: true, row: { state: 'approved', queue: 'fuse' } })
  expect(await approvePending(io, home, () => Date.parse(AT), row.id)).toMatchObject({ ok: false, reason: 'not-pending' })
  expect((await loadMergeState(io, home)).state.rows[0]?.state).toBe('approved')
})

it('rejects pending to skipped and reports unknown ids', async () => {
  const home = await tempRoot('dsh-merge-pending-reject-')
  const io = nodeEvolutionIo()
  const row = await pending(home)
  expect(await rejectPending(io, home, () => Date.parse(AT), row.id)).toMatchObject({ ok: true, row: { state: 'skipped', origin: 'human' } })
  expect(await rejectPending(io, home, () => Date.parse(AT), 'missing')).toMatchObject({ ok: false, reason: 'not-found' })
})
