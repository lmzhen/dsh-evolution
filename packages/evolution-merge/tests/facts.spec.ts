// @tier pre-tag
import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo, type EvolutionIoLike, type RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import type { MergeRow } from '../src/contracts.ts'
import { buildFacts, countsOf, readFacts } from '../src/facts.ts'
import { mergeStatePath } from '../src/state.ts'

const row = (patch: Partial<MergeRow>): MergeRow => ({ id: 'r', pairKey: 'a|b', a: 'a', b: 'b', state: 'verify', queue: 'verify', createdAt: 'c', updatedAt: 'c', ...patch }) as MergeRow

it('counts active/expired separately and never writes', () => {
  const rows = [
    row({ id: 'v' }),
    row({ id: 'p', state: 'pending', queue: 'pending' }),
    row({ id: 'e', state: 'pending', queue: 'pending', expired: 'target-taken' }),
    row({ id: 's', state: 'skipped', queue: 'skipped' }),
  ]
  expect(countsOf(rows)).toEqual({ active: { verify: 1, pending: 1, fuse: 0, skipped: 1 }, expired: 1 })
})

it('readFacts is GET-zero-write', async () => {
  const home = await tempRoot('dsh-facts-read-')
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [] }))
  const io = nodeEvolutionIo()
  let writes = 0
  const guarded: EvolutionIoLike = { ...io, writeText: async (path, content) => { writes += 1; await io.writeText(path, content) }, remove: async path => { writes += 1; await io.remove(path) }, rename: async (from, to) => { writes += 1; await io.rename(from, to) } }
  const facts = await readFacts({ io: guarded, home, runs: [], approval: false, readAt: 1 })
  expect(writes).toBe(0)
  expect(facts.counts).toEqual({ active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 })
})

it('projects active/last RunView from the run snapshot', () => {
  const runs: RunRecord[] = [
    { id: 'old', kind: 'merge', state: 'succeeded', startedAt: 1, endedAt: 2, command: 'scan', mergeStatus: 'succeeded' },
    { id: 'run', kind: 'merge', state: 'running', startedAt: 3, command: 'scan', mergeStatus: 'running' },
  ]
  const facts = buildFacts({ rows: [], runs, approval: false, readAt: 9, notes: ['state-unreadable'] })
  expect(facts.wireVersion).toBe(1)
  expect(facts.active).toMatchObject({ id: 'run', state: 'running' })
  expect(facts.last).toMatchObject({ id: 'old', state: 'succeeded' })
  expect(facts.degraded).toBe(true)
  expect(JSON.parse(JSON.stringify(facts))).toEqual(facts)
})
