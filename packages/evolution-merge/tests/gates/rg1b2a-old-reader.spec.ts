// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { makeV4Home } from '../support/schema4-home.ts'
import { loadMergeState, transactRows, mutateMergeState, upsertRow, moveRow, dropRow, dropRowV3 } from '../../src/state.ts'
import { parseLedger } from '../../src/domain/ledger.ts'

const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

it('keeps the legacy read/write surface forward-only zero-write on schema4', async () => {
  const { home, io } = await makeV4Home([])
  await mkdir(join(home, 'merge', 'staging-index'), { recursive: true })
  await mkdir(join(home, 'reports'), { recursive: true })
  await writeFile(join(home, 'runs.json'), '{"runs":[]}')
  await writeFile(join(home, 'merge', 'staging-index', 'r1.json'), '{"rowId":"r1"}')
  await writeFile(join(home, 'reports', 'merge-r.json'), '{}')
  const before = {
    state: hash(await readFile(join(home, 'merge', 'merge-state.json'), 'utf8')),
    runs: hash(await readFile(join(home, 'runs.json'), 'utf8')),
    staging: hash(await readFile(join(home, 'merge', 'staging-index', 'r1.json'), 'utf8')),
    report: hash(await readFile(join(home, 'reports', 'merge-r.json'), 'utf8')),
  }
  expect(parseLedger(await readFile(join(home, 'merge', 'merge-state.json'), 'utf8'))).toMatchObject({ ok: false, note: 'merge-state-forward-only' })
  expect((await loadMergeState(io, home)).ok).toBe(true)
  await expect(transactRows(io, home, tx => tx.rows().length)).rejects.toThrow()
  await expect(mutateMergeState(io, home, () => 1, rows => ({ rows, result: 0 }))).rejects.toThrow('legacy-writer-removed')
  await expect(upsertRow(io, home, () => 1, {} as never)).rejects.toThrow('legacy-writer-removed')
  await expect(moveRow(io, home, () => 1, 'r1', { queue: 'verify' })).rejects.toThrow('legacy-writer-removed')
  await expect(dropRow(io, home, () => 1, 'r1')).rejects.toThrow('legacy-writer-removed')
  await expect(dropRowV3(io, home, 'r1', 'superseded')).rejects.toThrow()
  const after = {
    state: hash(await readFile(join(home, 'merge', 'merge-state.json'), 'utf8')),
    runs: hash(await readFile(join(home, 'runs.json'), 'utf8')),
    staging: hash(await readFile(join(home, 'merge', 'staging-index', 'r1.json'), 'utf8')),
    report: hash(await readFile(join(home, 'reports', 'merge-r.json'), 'utf8')),
  }
  expect(after).toEqual(before)
})
