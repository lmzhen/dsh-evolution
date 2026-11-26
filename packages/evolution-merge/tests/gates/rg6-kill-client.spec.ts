import { seedRow } from '../support/seed-row.ts'
// @tier pre-tag
import { expect, it, vi } from 'vitest'
import { newRunRegistry, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { pairKey, rowIdOf, runApproveCommand, type MergeDecision, type MergeRow } from '../../src/index.ts'
import { readRunMeta } from '../../src/domain/run-coordinator.ts'

const AT = '2026-10-20T00:00:00.000Z'
const DECISION: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['a', 'b'], rationale: 'same' }

it('a detached run completes and stays readable after the client is gone', { timeout: 90_000 }, async () => {
  const home = await tempRoot('dsh-rg6-kill-client-')
  const io = nodeEvolutionIo()
  const key = pairKey('a', 'b')
  const planned: MergeRow = { id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'pending', queue: 'pending', decision: DECISION, runId: 'parent-run', createdAt: AT, updatedAt: AT }
  await seedRow(io, home, planned)
  const registry = newRunRegistry({ io, home, now: () => 1000 })
  const accepted = await runApproveCommand({ io, home, registry, rowId: planned.id, platformWrite: true, detached: true, now: () => 1000, ports: { async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } } })
  expect(accepted).toMatchObject({ ok: true, accepted: true })
  const runId = (accepted as { runId: string }).runId
  await vi.waitFor(() => expect(registry.find(runId)?.state).toBe('succeeded'), { timeout: 60_000, interval: 20 })
  const run = registry.find(runId)
  expect(run?.resultRef).toBeDefined()
  const report = await io.readText(run!.resultRef!)
  expect(report).not.toBeNull()
  expect(report).toContain('"schemaVersion"')
  // finish() writes run-meta after the registry settles; let it land before teardown.
  await vi.waitFor(async () => {
    const meta = await readRunMeta(io, home, runId)
    expect(meta).not.toBeNull()
    expect(meta?.phase).not.toBe('running')
  }, { timeout: 10_000, interval: 20 })
})
