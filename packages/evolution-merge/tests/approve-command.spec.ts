import { seedRow } from './support/seed-row.ts'
// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { loadMergeState, pairKey, rowIdOf, runApproveCommand, type MergeDecision, type MergeRegistryPort, type MergeRow } from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const DECISION: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['a', 'b'], rationale: 'same' }

async function pending(home: string) {
  const key = pairKey('a', 'b')
  const row: MergeRow = {
    id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'pending', queue: 'pending',
    decision: DECISION, runId: 'parent-run', createdAt: AT, updatedAt: AT,
  }
  await seedRow(nodeEvolutionIo(), home, row)
  return row
}

function registry(): MergeRegistryPort {
  return {
    async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 100 } },
    async stage() {},
    async settle() {},
  }
}

it('approves one pending row and drops it after a successful round2', async () => {
  const home = await tempRoot('dsh-merge-approve-command-')
  const io = nodeEvolutionIo()
  const row = await pending(home)
  const result = await runApproveCommand({
    io, home, registry: registry(), rowId: row.id, platformWrite: true, now: () => 200,
    ports: { async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } },
  })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  if (!result.ok) return
  if (!('report' in result)) return
  expect(result.report.totals).toEqual({ merged: 1, kept: 0, pending: 0, failed: 0 })
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
})

it('refuses a second approve and leaves no pending row', async () => {
  const home = await tempRoot('dsh-merge-approve-command-second-')
  const io = nodeEvolutionIo()
  const row = await pending(home)
  const opts = {
    io, home, registry: registry(), rowId: row.id, platformWrite: true, now: () => 200,
    ports: { async round2() { return { kind: 'failed' as const } } },
  }
  expect((await runApproveCommand(opts)).ok).toBe(false)
  expect((await runApproveCommand(opts)).ok).toBe(false)
  const rows = (await loadMergeState(io, home)).state.rows
  expect(rows.some(item => item.id === row.id)).toBe(true)
})
