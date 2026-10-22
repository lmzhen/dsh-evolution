// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mergeDoctor, pairKey, rowIdOf, upsertRow, type MergeRow } from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const row = (a: string, b: string, state: MergeRow['state']): MergeRow => {
  const key = pairKey(a, b)
  return { id: rowIdOf(key), pairKey: key, a, b, state, queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : state === 'fuse' || state === 'approved' ? 'fuse' : 'verify', createdAt: AT, updatedAt: AT }
}

it('reports empty, populated and unreadable state without writing', async () => {
  const home = await tempRoot('dsh-merge-doctor-')
  const io = nodeEvolutionIo()
  const empty = await mergeDoctor(io, home)
  expect(empty.map(item => item.key)).toEqual(['state', 'models', 'staging', 'staging-path'])
  expect(empty[0]).toMatchObject({ status: 'ok' })
  await upsertRow(io, home, () => Date.parse(AT), row('alpha-skill', 'beta-skill', 'pending'))
  const rows = await mergeDoctor(io, home)
  expect(rows[0]?.detail).toContain('pending 1')
})
