// @tier pre-tag
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { newRunRegistry, nodeEvolutionIo, runsFile } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))

it('hasOwner tracks a live run and clears after settle', async () => {
  const home = await tempRoot('dsh-rg0b-owner-')
  const registry = newRunRegistry({ io: nodeEvolutionIo(), home, now: () => 1 })
  const handle = await registry.begin('merge', { command: 'scan' })
  expect(await registry.hasOwner(handle.id)).toBe(true)
  await registry.settle(handle.id, { state: 'succeeded' })
  expect(await registry.hasOwner(handle.id)).toBe(false)
  expect(await registry.hasOwner('missing-run')).toBe(false)
})

it('does not treat a dead-owner orphan as live', async () => {
  const home = await tempRoot('dsh-rg0b-orphan-')
  const registry = newRunRegistry({ io: nodeEvolutionIo(), home, now: () => 1 })
  const handle = await registry.begin('merge', { command: 'scan' })
  const path = runsFile(home)
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { runs?: Array<{ id: string; pid?: number }> }
  const record = raw.runs?.find(item => item.id === handle.id)
  if (record === undefined) throw new Error('run record missing')
  record.pid = 999_999
  writeFileSync(path, JSON.stringify(raw))
  const reloaded = newRunRegistry({ io: nodeEvolutionIo(), home, now: () => 2 })
  await reloaded.load()
  expect(await reloaded.hasOwner(handle.id)).toBe(false)
})

it('remaining owner writer scan has no legacy row writer', () => {
  const files = readdirSync(root + '/src', { recursive: true }).map(String).filter(name => name.endsWith('.ts'))
  const legacy = files.filter(file => file !== 'state.ts' && /\b(upsertRow|dropRow|moveRow|mutateMergeState)\b/.test(readFileSync(root + '/src/' + file, 'utf8')))
  expect(legacy).toEqual([])
  const rowTx = files.filter(file => /\b(transactRows|dropRowV3)\b/.test(readFileSync(root + '/src/' + file, 'utf8')))
  expect(rowTx.map(file => file.replaceAll('\\', '/')).sort()).toEqual(['state.ts'])
})
