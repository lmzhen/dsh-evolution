// @tier pre-tag
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { ensureMergeStateReady, v2BackupPath } from '../../src/domain/state-bootstrap.ts'
import { mergeStatePath } from '../../src/state.ts'

const sample = fileURLToPath(new URL('../fixtures/0.30.15/real/merge/merge-state.json', import.meta.url))

it('applies the B1 0.30.15 published-writer sample with zero quarantine', async () => {
  const home = await tempRoot('dsh-rg1b-real-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const raw = await readFile(sample, 'utf8')
  await writeFile(mergeStatePath(home), raw)
  const result = await ensureMergeStateReady(io, home)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const parsed = JSON.parse(raw) as { rows: Array<{ id: string; state: string; pairKey: string; a: string; b: string }> }
  expect(result.state.rows).toHaveLength(parsed.rows.length)
  expect(result.quarantine).toHaveLength(0)
  expect(result.state.rows.map(row => [row.id, row.state, row.pairKey, row.a, row.b])).toEqual(parsed.rows.map(row => [row.id, row.state, row.pairKey, row.a, row.b]))
  expect(await readFile(v2BackupPath(home), 'utf8')).toBe(raw)
})
