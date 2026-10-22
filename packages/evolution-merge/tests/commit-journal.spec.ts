// @tier pre-tag
import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceJournal, recoveryFor, type CommitJournal } from '../src/domain/commit-journal.ts'

const base: CommitJournal = { runId: 'r1', unitId: 'u1', target: 't', create: false, sources: ['s'], phase: 'prepared', updatedAt: 'x' }

test('target-first journal phases advance in order', () => {
  const written = advanceJournal(base, 'target-written', 't1')
  const archived = advanceJournal(written, 'sources-archived', 't2')
  const committed = advanceJournal(archived, 'committed', 't3')
  assert.equal(committed.phase, 'committed')
})

test('restart recovery is derived from the durable phase', () => {
  assert.equal(recoveryFor(base), 'retry-commit')
  assert.equal(recoveryFor(advanceJournal(base, 'target-written', 't1')), 'rollback-target')
  assert.equal(recoveryFor(advanceJournal(advanceJournal(base, 'target-written', 't1'), 'sources-archived', 't2')), 'rollback-sources')
  assert.equal(recoveryFor(advanceJournal(base, 'failed', 't1')), 'none')
})

test('failure paths roll back; terminal phases stop', () => {
  assert.equal(advanceJournal(base, 'failed', 't1').phase, 'failed')
  assert.equal(advanceJournal(advanceJournal(base, 'target-written', 't1'), 'rolled-back', 't2').phase, 'rolled-back')
  assert.throws(() => advanceJournal(advanceJournal(base, 'failed', 't1'), 'committed', 't2'))
})
