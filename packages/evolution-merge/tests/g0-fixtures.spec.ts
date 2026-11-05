// @tier pre-tag
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadUsage, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { loadMergeState } from '../src/index.ts'
import { seedArchivedUsage, seedPendingMerge } from '../../scripts/acceptance/fixtures.mjs'

it('G0 fixture seeds a managed pending pair that the v3 reader accepts', async () => {
  const home = await tempRoot('dsh-g0-pending-')
  const seeded = await seedPendingMerge(home, { a: 'g0-merge-a', b: 'g0-merge-b' })
  const loaded = await loadMergeState(nodeEvolutionIo(), join(home, 'evolution'))
  const row = loaded.state.rows.find(item => item.id === seeded.id)
  expect(row).toMatchObject({
    id: seeded.id,
    a: 'g0-merge-a',
    b: 'g0-merge-b',
    state: 'pending',
    target: { requested: 'g0-merge-a' },
  })
  expect(row?.decision?.shouldMerge).toBe(true)
  expect(await readFile(join(home, 'skills', 'g0-merge-a', '.hermes-managed'), 'utf8')).toBe('')
  expect(JSON.parse(await readFile(join(home, 'skills', '.history', 'skills', 'g0-merge-a', 'index.json'), 'utf8')).versions).toHaveLength(1)
})

it('G0 fixture writes a real archived_at and archive reason', async () => {
  const home = await tempRoot('dsh-g0-archive-')
  const at = '2026-10-01T12:00:00.000Z'
  await seedArchivedUsage(home, 'g0-archived', at, 'G0 archive fixture')
  const usage = await loadUsage(join(home, 'skills'))
  expect(usage.get('g0-archived')).toMatchObject({ state: 'archived', archived_at: at })
  expect(await readFile(join(home, 'skills', '.archive', 'g0-archived', '.archive-reason'), 'utf8')).toBe('G0 archive fixture\n')
})
