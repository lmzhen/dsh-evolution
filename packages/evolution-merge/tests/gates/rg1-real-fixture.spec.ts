// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { fileURLToPath } from 'node:url'
import { loadMergeState } from '../../src/state.ts'

const home = fileURLToPath(new URL('../fixtures/0.30.15/real/', import.meta.url))

it('loads the 0.30.15-generated five-state fixture without quarantine', async () => {
  const loaded = await loadMergeState(nodeEvolutionIo(), home)
  expect(loaded.ok).toBe(true)
  expect(loaded.state.rows.map(row => row.state).sort()).toEqual(['approved', 'fuse', 'pending', 'skipped', 'verify'])
})
