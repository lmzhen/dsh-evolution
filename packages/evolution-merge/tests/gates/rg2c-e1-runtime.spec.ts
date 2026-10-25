// @tier pre-tag
import { expect, it } from 'vitest'
import { runApproveCommand } from '../../src/approve-command.ts'
import { loadMergeState } from '../../src/state.ts'
import { makeV4Home, v3Row } from '../support/schema4-home.ts'

const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }

it('candidate runtime approve on a real schema4 home projects report then removes row', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p1', state: 'pending', target: 'a', decision, runId: 'parent-run' })])
  const result = await runApproveCommand({
    io: v4.io, home: v4.home, rowId: 'p1', platformWrite: false, now: () => 100,
    registry: { async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 1 } }, async stage() {}, async settle() {} },
    ports: { async round2() { return { kind: 'merged', unitId: 'u-1', evidenceSha256: 'sha' } } },
  })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  expect((await loadMergeState(v4.io, v4.home)).state.rows).toEqual([])
})
