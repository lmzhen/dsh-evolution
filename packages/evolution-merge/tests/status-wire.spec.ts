// @tier pre-tag
import { expect, it } from 'vitest'
import type { Facts, RunsView } from '../src/wire.ts'
import { formatFacts, formatRunsView } from '../src/status.ts'

const counts = { active: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }
it('formats Facts and RunsView without localized host strings', () => {
  const facts: Facts = { wireVersion: 1, readAt: 1, approval: { mergeApproval: false }, counts, active: null, last: null, startCommands: { scan: 's', pair: 'p' }, fallback: [], notes: [], degraded: false }
  expect(formatFacts(facts)).toContain('merge: verify 0')
  const runs: RunsView = { wireVersion: 1, readAt: 1, runs: [{ wireVersion: 1, readAt: 1, id: 'r', state: 'running', command: 'scan', startedAt: 1, actions: [] }] }
  expect(formatRunsView(runs)).toContain('r [running]')
})
