// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { loadMergeState, transactRows } from '../../src/state.ts'
import { createReadOnlyMergeService, runMergeCommand } from '../../src/merge-command.ts'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'

it('fails closed on a v3 state instead of reading it as empty', async () => {
  const home = await tempRoot('dsh-g1-forward-only-')
  mkdirSync(join(home, 'merge'), { recursive: true })
  const target = join(home, 'merge', 'merge-state.json')
  const source = fileURLToPath(new URL('../fixtures/0.30.15/sentinel/v3-state.json', import.meta.url))
  const bytes = readFileSync(source)
  writeFileSync(target, bytes)
  const before = createHash('sha256').update(bytes).digest('hex')
  const loaded = await loadMergeState(nodeEvolutionIo(), home)
  expect(loaded.ok).toBe(false)
  expect(loaded.note).toBe('merge-state-forward-only')
  expect(loaded.state.rows).toEqual([])
  expect(createHash('sha256').update(readFileSync(target)).digest('hex')).toBe(before)
  const service = createReadOnlyMergeService(nodeEvolutionIo(), home)
  const result = await runMergeCommand(service, 'merge status')
  expect(result.ok).toBe(false)
  expect(result.text).toMatch(/merge-state-(forward-only|normalize-required)/)
  await expect(transactRows(nodeEvolutionIo(), home, () => 1)).rejects.toThrow('legacy-writer-removed')
  expect(createHash('sha256').update(readFileSync(target)).digest('hex')).toBe(before)
})
