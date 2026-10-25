// @tier pre-tag
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { newRunRegistry, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'

it('core RunRegistry no longer writes merge-specific fields and reads old rows', async () => {
  const home = await tempRoot('dsh-rg1b2b-core-')
  const io = nodeEvolutionIo()
  const registry = newRunRegistry({ io, home, now: () => 1 })
  const handle = await registry.begin('merge', { command: 'scan' })
  await registry.settle(handle.id, { state: 'succeeded' })
  const raw = JSON.parse(await readFile(join(home, 'runs.json'), 'utf8')) as { runs: Record<string, unknown>[] }
  const row = raw.runs.find(item => item.id === handle.id)
  expect(row).toBeDefined()
  for (const key of ['mergeStatus', 'pairKey', 'pairs', 'stagingRef']) expect(row).not.toHaveProperty(key)
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(join(home, 'runs.json'), JSON.stringify({ schemaVersion: 1, runs: [{ id: 'old', kind: 'merge', state: 'succeeded', startedAt: 1, endedAt: 2, command: 'scan', mergeStatus: 'orphan', pairKey: 'a', pairs: [] }] }))
  const old = newRunRegistry({ io, home, now: () => 2 })
  await old.load()
  expect(old.find('old')).toMatchObject({ id: 'old', state: 'succeeded' })
})

it('core writer source has no merge field assignment', async () => {
  const source = await readFile(new URL('../../../evolution-core/src/run-registry.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(/(mergeStatus|stagingRef|pairKey|pairs)\s*=/)
  expect(source).not.toMatch(/seed\?\.(mergeStatus|stagingRef|pairKey|pairs)/)
})
