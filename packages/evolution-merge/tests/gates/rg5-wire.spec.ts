// @tier pre-tag
import { expect, it } from 'vitest'
import { buildFacts } from '../../src/facts.ts'
import { MERGE_COMMAND_SURFACE } from '../../src/command-surface.ts'
import { actionRefs, toBodyView, toDoctorView, toHistoryView, toQueuePage, toRunsView } from '../../src/wire-projection.ts'
import type { RunRecord } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRow } from '../../src/contracts.ts'
import type { RunDetail } from '../../src/wire.ts'

const row: MergeRow = { id: 'r', pairKey: 'a|b', a: 'a', b: 'b', state: 'pending', queue: 'pending', createdAt: 'x', updatedAt: 'x' }
const run: RunRecord = { id: 'run', kind: 'merge', state: 'running', startedAt: 1, command: 'scan' }
const counts = { active: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0 }

it('all seven wire envelopes carry wireVersion=1', () => {
  const facts = buildFacts({ rows: [row], runs: [run], approval: true, readAt: 1 })
  const page = toQueuePage([row], 'pending', false, 1)
  const runs = toRunsView([run], 1)
  const detail: RunDetail = { ...runs.runs[0]!, pairs: [], pairsTruncated: false }
  const body = toBodyView('a', 'live', 'x', 1)
  const history = toHistoryView([], 1)
  const doctor = toDoctorView({ readAt: 1, counts, approval: { mergeApproval: true }, staging: { state: 'ok', dirs: 0 }, rows: [] })
  for (const envelope of [facts, page, runs, runs.runs[0]!, detail, body, history, doctor]) expect(envelope.wireVersion).toBe(1)
})

it('ActionRef and CommandSurface are JSON-safe and copy-complete', () => {
  const actions = actionRefs(row)
  expect(actions.map(item => item.id)).toEqual(['approve', 'reject', 'discard'])
  const expired = actionRefs({ ...row, expired: 'target-taken' })
  expect(expired.map(item => item.id)).toEqual(['discard', 'pair'])
  expect(expired.every(item => item.enabled)).toBe(true)
  for (const action of actions) {
    expect(action.command.startsWith('/evolution merge ')).toBe(true)
    expect(JSON.parse(JSON.stringify(action))).toEqual(action)
  }
  expect(MERGE_COMMAND_SURFACE.wireVersion).toBe(1)
  expect(MERGE_COMMAND_SURFACE.commands).toHaveLength(19)
  expect(MERGE_COMMAND_SURFACE.fallback.length).toBeGreaterThanOrEqual(7)
  expect(JSON.parse(JSON.stringify(MERGE_COMMAND_SURFACE))).toEqual(MERGE_COMMAND_SURFACE)
})
