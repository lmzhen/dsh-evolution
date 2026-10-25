import { seedRow } from '../support/seed-row.ts'
// @tier pre-tag
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { newRunRegistry, nodeEvolutionIo, runsFile } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { loadMergeState, pairKey, rowIdOf, runResumeCommand, type MergeDecision, type MergeRow } from '../../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const DECISION: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['a', 'b'], rationale: 'same' }

it('restart marks a dead-owner running run as orphan and never auto-resumes', async () => {
  const home = await tempRoot('dsh-rg6-restart-')
  const first = newRunRegistry({ io: nodeEvolutionIo(), home, now: () => 1 })
  const handle = await first.begin('merge', { command: 'approve' })
  const path = runsFile(home)
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { runs?: Array<{ id: string; pid?: number }> }
  const record = raw.runs?.find(item => item.id === handle.id)
  if (record === undefined) throw new Error('run record missing')
  record.pid = 999_999
  writeFileSync(path, JSON.stringify(raw))
  const second = newRunRegistry({ io: nodeEvolutionIo(), home, now: () => 2 })
  await second.load()
  const found = second.find(handle.id)
  expect(found?.state).toBe('failed')
  expect(found?.state).toBe('failed')
  expect(second.inFlight('merge')).toBeUndefined()
})

it('typed settleOrphan only settles a running run once', async () => {
  const home = await tempRoot('dsh-rg6-settle-orphan-')
  const registry = newRunRegistry({ io: nodeEvolutionIo(), home, now: () => 1 })
  const handle = await registry.begin('merge', { command: 'scan' })
  expect(await registry.settleOrphan(handle.id)).toBe(true)
  expect(registry.find(handle.id)).toMatchObject({ state: 'failed' })
  expect(await registry.settleOrphan(handle.id)).toBe(false)
})

it('manual resume after restart is explicit and can complete', async () => {
  const home = await tempRoot('dsh-rg6-manual-resume-')
  const io = nodeEvolutionIo()
  const key = pairKey('a', 'b')
  const planned: MergeRow = { id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'fuse', queue: 'fuse', decision: DECISION, runId: 'parent-run', createdAt: AT, updatedAt: AT }
  await seedRow(io, home, planned)
  const registry = newRunRegistry({ io, home, now: () => 1000 })
  const accepted = await runResumeCommand({ io, home, registry, rowId: planned.id, platformWrite: true, detached: true, now: () => 1000, ports: { async screening() { return [{ a: 'a', b: 'b' }] }, async round1() { return { kind: 'keep' } }, async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } } })
  expect(accepted).toMatchObject({ ok: true, accepted: true })
  for (let i = 0; i < 2000 && (await loadMergeState(io, home)).state.rows.length > 0; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
})
