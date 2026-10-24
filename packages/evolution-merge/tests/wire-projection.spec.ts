// @tier pre-tag
import { expect, it } from 'vitest'
import type { MergeRow } from '../src/contracts.ts'
import { toBodyView, toDoctorView, toHistoryView, toQueuePage, toRowFact, toRunsView } from '../src/wire-projection.ts'
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'

const row = (patch: Partial<MergeRow>): MergeRow => ({ id: 'r', pairKey: 'a|b', a: 'a', b: 'b', state: 'verify', queue: 'verify', createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', ...patch }) as MergeRow

it('projects rows and queue pages with active/expired separation', () => {
  const rows = [row({ id: 'v' }), row({ id: 'e', state: 'pending', queue: 'pending', expired: 'target-taken' })]
  expect(toRowFact(rows[0]!)).toMatchObject({ state: 'verify', verifySubState: 'queued' })
  const page = toQueuePage(rows, 'pending', true, 1)
  expect(page).toMatchObject({ wireVersion: 1, queue: 'pending', expiredOnly: true })
  expect(page.rows.map(item => item.id)).toEqual(['e'])
  expect(page.counts.active.pending).toBe(0)
  expect(page.counts.expired).toBe(1)
})

it('host generates copy-only ActionRefs and keeps 2000 rows stable', () => {
  const pending = row({ id: 'p', state: 'pending', queue: 'pending' })
  expect(toRowFact(pending).actions.map(item => item.id)).toEqual(['approve', 'reject', 'discard'])
  const rows = Array.from({ length: 2000 }, (_, index) => row({ id: 'r' + String(index) }))
  const page = toQueuePage(rows, 'verify', false, 1, 50)
  expect(page.rows).toHaveLength(50)
  expect(page.counts.active.verify).toBe(2000)
  expect(page.nextCursor).toBe('50')
})

it('projects RunsView and DoctorView', () => {
  const runs: RunRecord[] = [{ id: 'a', kind: 'merge', state: 'succeeded', startedAt: 1, command: 'scan' }]
  expect(toRunsView(runs, 1)).toMatchObject({ wireVersion: 1, runs: [{ id: 'a', state: 'succeeded' }] })
  const doctor = toDoctorView({ readAt: 1, counts: { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }, approval: { mergeApproval: false }, staging: { state: 'ok', dirs: 0 }, rows: [{ key: 'state', status: 'ok', detail: 'x' }] })
  expect(doctor).toMatchObject({ wireVersion: 1, rows: [{ key: 'state', status: 'ok' }] })
})

it('projects body and history envelopes', () => {
  expect(toBodyView('a', 'live', 'hello', 1)).toMatchObject({ wireVersion: 1, totalBytes: 5, truncated: false })
  expect(toHistoryView([{ name: 'a', kind: 'merged', reason: 'absorbed', lastVersion: 2, archivedAt: '2026-10-23T00:00:00.000Z' }], 1).items[0]).toMatchObject({ name: 'a', archivedAt: Date.parse('2026-10-23T00:00:00.000Z') })
})
