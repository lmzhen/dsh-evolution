import { seedRow } from './support/seed-row.ts'
// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { loadMergeState, pairKey, rowIdOf, runApproveCommand, runResumeCommand, type MergeDecision, type MergeRegistryPort, type MergeRow } from '../src/index.ts'

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

it('carries the reserved staging ref into round2 instead of inventing a second key', async () => {
  const home = await tempRoot('dsh-merge-approve-staging-ref-')
  const io = nodeEvolutionIo()
  const row = await pending(home)
  let seen: string | undefined
  await runApproveCommand({
    io, home, registry: registry(), rowId: row.id, platformWrite: true, now: () => 200,
    ports: {
      async stage() { return { ok: true as const, entry: { version: 1 as const, rowId: row.id, pairKey: row.pairKey, ref: 'stage-A', state: 'present' as const, createdAt: 1, expiresAt: 999999999999, updatedAt: 1 } } },
      async round2(next) { seen = next.stagingRef; return { kind: 'failed', failure: { stage: 'author', code: 'merge-failed', message: 'fixture', retryable: true, retryFrom: 'agent2' } } },
    },
  })
  expect(seen).toBe('stage-A')
})

it('P1-8: attaches the in-flight child run to the row before round2', async () => {
  const home = await tempRoot('dsh-merge-approve-attach-')
  const io = nodeEvolutionIo()
  const row = await pending(home)
  let started: () => void = () => {}
  const began = new Promise<void>(resolve => { started = resolve })
  let release: () => void = () => {}
  const hold = new Promise<void>(resolve => { release = resolve })
  const liveRegistry: MergeRegistryPort = {
    async begin() { return { id: 'run-live', signal: new AbortController().signal, startedAt: 100 } },
    async stage() {},
    async settle() {},
  }
  const approving = runApproveCommand({
    io, home, registry: liveRegistry, rowId: row.id, platformWrite: true, now: () => 200,
    ports: { async round2() { started(); await hold; return { kind: 'failed', failure: { stage: 'author', code: 'merge-failed', message: 'fixture', retryable: true, retryFrom: 'agent2' } } } },
  })
  await began
  const attached = (await loadMergeState(io, home)).state.rows.find(item => item.id === row.id)
  expect(attached?.runId).toBe('run-live')
  const resumed = await runResumeCommand({
    io, home, registry: liveRegistry, rowId: row.id, platformWrite: true, now: () => 200,
    isOwnerActive: async id => id === 'run-live',
    ports: { async screening() { return [] }, async round1() { return { kind: 'keep' } }, async round2() { return { kind: 'failed' } } },
  })
  expect(resumed.ok).toBe(false)
  expect(resumed.ok ? '' : resumed.message).toContain('运行中的 run')
  release()
  await approving
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
