// @tier pre-tag
import { expect, it } from 'vitest'
import { WIRE_VERSION, type DoctorView, type Facts, type QueuePage, type RunView } from '../src/wire.ts'

const counts = { active: { verify: 1, pending: 0, fuse: 0, skipped: 0 }, expired: 0 }
const run: RunView = { wireVersion: 1, readAt: 1, id: 'r', state: 'running', command: 'scan', stage: 'screening', progress: null, startedAt: 1, actions: [] }

it('wireVersion is frozen at 1 on every envelope', () => {
  const facts: Facts = { wireVersion: 1, readAt: 1, approval: { mergeApproval: false }, counts, active: run, last: null, startCommands: { scan: 'scan', pair: 'pair' }, fallback: [], notes: [], degraded: false }
  const page: QueuePage = { wireVersion: 1, readAt: 1, queue: 'verify', expiredOnly: false, counts, rows: [], notes: [] }
  const doctor: DoctorView = { wireVersion: 1, readAt: 1, counts, approval: { mergeApproval: false }, staging: { state: 'ok', dirs: 0 }, rows: [] }
  expect(WIRE_VERSION).toBe(1)
  for (const value of [facts, page, doctor, run]) {
    expect(value.wireVersion).toBe(1)
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  }
})
