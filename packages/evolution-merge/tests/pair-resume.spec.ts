// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import {
  loadMergeState,
  pairKey,
  rowIdOf,
  runPairCommand,
  runResumeCommand,
  upsertRow,
  type MergeDecision,
  type MergeRegistryPort,
  type MergeRow,
  type ScanPorts,
} from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const DECISION: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['a', 'b'], rationale: 'same' }

function registry(): MergeRegistryPort {
  return {
    async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 100 } },
    async stage() {},
    async settle() {},
  }
}

function ports(): ScanPorts {
  return {
    async screening() { return [{ a: 'a', b: 'b' }] },
    async round1() { return { kind: 'keep' } },
    async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } },
  }
}

it('runs an explicit pair through the scan shell', async () => {
  const home = await tempRoot('dsh-merge-pair-command-')
  const io = nodeEvolutionIo()
  const result = await runPairCommand({
    io, home, registry: registry(), ports: ports(), a: 'a', b: 'b',
    approval: false, platformWrite: true, now: () => 200,
  })
  expect(result.ok).toBe(true)
  expect((await loadMergeState(io, home)).state.rows.map(row => row.state)).toEqual(['skipped'])
})

it('resumes a fuse row with its persisted decision', async () => {
  const home = await tempRoot('dsh-merge-resume-command-')
  const io = nodeEvolutionIo()
  const key = pairKey('a', 'b')
  const row: MergeRow = {
    id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'fuse', queue: 'fuse',
    decision: DECISION, createdAt: AT, updatedAt: AT,
  }
  await upsertRow(io, home, () => Date.parse(AT), row)
  const result = await runResumeCommand({
    io, home, registry: registry(), ports: ports(), rowId: row.id,
    platformWrite: true, now: () => 200,
  })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  if (!result.ok) return
  expect(result.report.totals.merged).toBe(1)
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
})
