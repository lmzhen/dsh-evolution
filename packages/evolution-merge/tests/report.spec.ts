// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import {
  committedPairs,
  mergeReportDigestPath,
  mergeReportPath,
  readMergeReport,
  writeMergeReport,
  type MergeReport,
} from '../src/index.ts'

const AT = 1761000000000

function fixture(runId: string): MergeReport {
  return {
    schemaVersion: 2,
    runId,
    kind: 'merge',
    command: 'scan',
    startedAt: AT,
    endedAt: AT + 1000,
    stopReason: 'completed',
    approval: { platformWrite: true, mergeApproval: false },
    scope: { candidatePairs: 2, queueBefore: { verify: 0, pending: 0, fuse: 2, skipped: 0 } },
    pairs: [
      {
        id: 'mr_a', pairKey: 'a\u0000b', a: 'a', b: 'b', queue: 'fuse', outcome: 'merged',
        archived: ['b'], unitId: 'u-1', target: { requested: 'a', actual: 'a', created: false },
      },
      { id: 'mr_c', pairKey: 'c\u0000d', a: 'c', b: 'd', queue: 'verify', outcome: 'failed', archived: [] },
    ],
    totals: { merged: 1, kept: 0, pending: 0, failed: 1 },
    notes: ['one note'],
  }
}

it('writes JSON and a digest, then reads the same report', async () => {
  const home = await tempRoot('dsh-merge-report-')
  const io = nodeEvolutionIo()
  const report = fixture('run-1')
  const path = await writeMergeReport(io, home, report)
  expect(path).toBe(mergeReportPath(home, 'run-1'))
  expect(await io.readText(mergeReportDigestPath(home, 'run-1'))).toContain('command: scan')
  const loaded = await readMergeReport(io, home, 'run-1')
  expect(loaded).toMatchObject({ kind: 'present', value: report })
})

it('distinguishes absent, malformed and committed pairs', async () => {
  const home = await tempRoot('dsh-merge-report-probe-')
  const io = nodeEvolutionIo()
  expect(await readMergeReport(io, home, 'missing')).toEqual({ kind: 'absent' })
  await io.writeText(mergeReportPath(home, 'bad'), '{not json')
  expect((await readMergeReport(io, home, 'bad')).kind).toBe('unknown')
  await writeMergeReport(io, home, fixture('run-2'))
  expect((await committedPairs(io, home, 'run-2')).map(pair => pair.id)).toEqual(['mr_a'])
  expect(await committedPairs(io, home, 'missing')).toEqual([])
})
