import { seedRow } from './support/seed-row.ts'
// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { handleReadOnlyMergeCommand, pairKey, rowIdOf, type MergeRow } from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const row = (a: string, b: string, state: MergeRow['state']): MergeRow => {
  const key = pairKey(a, b)
  return { id: rowIdOf(key), pairKey: key, a, b, state, queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : state === 'fuse' || state === 'approved' ? 'fuse' : 'verify', createdAt: AT, updatedAt: AT }
}

it('serves status/pending/skipped from the ledger', async () => {
  const home = await tempRoot('dsh-merge-read-commands-')
  const io = nodeEvolutionIo()
  const pending = row('alpha-skill', 'beta-skill', 'pending')
  await seedRow(io, home, pending)
  await seedRow(io, home, row('gamma-skill', 'delta-skill', 'pending'))
  await seedRow(io, home, row('epsilon-skill', 'zeta-skill', 'skipped'))
  expect(await handleReadOnlyMergeCommand({ verb: 'status' }, io, home)).toContain('verify 0, pending 2, fuse 0, skipped 1')
  expect(await handleReadOnlyMergeCommand({ verb: 'pending' }, io, home)).toContain('alpha-skill + beta-skill')
  const filtered = await handleReadOnlyMergeCommand({ verb: 'pending' }, io, home, [{ name: 'alpha-skill' }, { name: 'beta-skill' }])
  expect(filtered).toContain('alpha-skill + beta-skill')
  expect(filtered).not.toContain('gamma-skill + delta-skill')
  expect(await handleReadOnlyMergeCommand({ verb: 'skipped' }, io, home)).toContain('epsilon-skill + zeta-skill')
  expect(await handleReadOnlyMergeCommand({ verb: 'status', id: 'missing' }, io, home)).toContain('not found')
  expect(await handleReadOnlyMergeCommand({ verb: 'scan' }, io, home)).toBeNull()
})
