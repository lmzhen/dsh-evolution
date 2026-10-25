// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { readMergeSnapshot } from '../../src/domain/merge-snapshot.ts'
import { buildFacts, buildQueuePage, buildRunsView, toRowFact } from '../../src/surface/merge-view.ts'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'

it('emits stage canonically and derives old staging from the same stage entry', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'r1', state: 'fuse', target: 'a', decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' } })])
  await mkdir(join(v4.home, 'merge', 'staging-index'), { recursive: true })
  await writeFile(join(v4.home, 'merge', 'staging-index', 'r1.json'), JSON.stringify({ version: 1, rowId: 'r1', pairKey: 'a\u0000b', ref: 'run/pairs/a', state: 'lost', expiresAt: 9, updatedAt: 1 }))
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: true, platformWrite: false })
  const row = toRowFact(snapshot.rows[0]!)
  expect(row.stage).toBe('lost')
  expect(row.staging).toBeUndefined()
  expect(buildFacts(snapshot).approval).toEqual({ mergeApproval: true, platformWrite: false })
  expect(buildQueuePage(snapshot, snapshot.rows[0]!.queue, false).rows[0]?.stage).toBe('lost')
})

it('exposes resultRef only in CLI RunsView', async () => {
  const v4 = await makeV4Home([])
  const run: RunRecord = { id: 'run-1', kind: 'merge', state: 'succeeded', startedAt: 1, endedAt: 2, command: 'scan', resultRef: '/tmp/report.json' }
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [run], approval: false, platformWrite: true })
  expect(buildRunsView(snapshot).runs[0]?.resultRef).toBe('/tmp/report.json')
  expect(buildFacts(snapshot).active?.resultRef).toBeUndefined()
})
