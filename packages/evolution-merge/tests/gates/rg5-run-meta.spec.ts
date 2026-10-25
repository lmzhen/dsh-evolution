// @tier pre-tag
import { expect, it } from 'vitest'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'
import { readMergeSnapshot } from '../../src/domain/merge-snapshot.ts'
import { writeRunMeta } from '../../src/domain/run-coordinator.ts'
import { reconcileMergeState } from '../../src/domain/reconcile.ts'
import { buildFacts, buildRunsView } from '../../src/surface/merge-view.ts'

it('excludes skipped TTL rows from active counts and exposes run-meta state', async () => {
  const v4 = await makeV4Home([v3Row({ id: 's1', state: 'skipped', reason: 'kept', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } as never)])
  const run = { id: 'run-1', kind: 'merge' as const, state: 'running' as const, startedAt: 1, command: 'scan' as const, resultRef: '/tmp/r.json' }
  await writeRunMeta(v4.io, v4.home, { version: 1, runId: 'run-1', phase: 'undone', stopReason: 'cancelled', resultRef: '/tmp/r.json', createdAt: 'c', updatedAt: 'u' })
  const report = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => 10 * 86_400_000, ttlDays: 1 })
  expect(report.actions.map(action => action.code)).toEqual(['skipped-ttl'])
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [run], approval: false })
  expect(snapshot.rows[0]?.row.expiredAt).toBe(10 * 86_400_000)
  expect((await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: false })).rows).toHaveLength(1)
  expect(buildFacts(snapshot).counts.active.skipped).toBe(0)
  expect(buildFacts(snapshot).counts.expired).toBe(1)
  const view = buildRunsView(snapshot).runs[0]
  expect(view?.state).toBe('undone')
  expect(view?.stopReason).toBe('cancelled')
  expect(view?.resultRef).toBe('/tmp/r.json')
})
