// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { assertUnitJournalTransition, readUnitJournal, unitJournalPath, writeUnitJournal, type UnitJournal } from '../src/unit-journal.ts'

it('journals monotonic phases and rejects terminal/backwards transitions', () => {
  expect(() => { assertUnitJournalTransition('prepared', 'target-pending') }).not.toThrow()
  expect(() => { assertUnitJournalTransition('target-pending', 'target-written') }).not.toThrow()
  expect(() => { assertUnitJournalTransition('target-written', 'source-archiving') }).not.toThrow()
  expect(() => { assertUnitJournalTransition('source-archiving', 'sources-archived') }).not.toThrow()
  expect(() =>{  assertUnitJournalTransition('sources-archived', 'committed'); }).not.toThrow()
  expect(() =>{  assertUnitJournalTransition('committed', 'prepared'); }).toThrow()
  expect(() =>{  assertUnitJournalTransition('committed', 'failed'); }).toThrow(/terminal/)
  expect(() =>{  assertUnitJournalTransition('target-written', 'prepared'); }).toThrow()
})

it('writes and reads a journal under a safe run path', async () => {
  const home = await tempRoot('dsh-unit-journal-')
  const io = nodeEvolutionIo()
  const journal: UnitJournal = { schemaVersion: 1, unitId: 'run-1:abc', runId: 'run-1/pairs/x:y', planDigest: 'd1', target: 'alpha', sources: ['beta'], phase: 'prepared', storageKey: 'k', snapshotSha256: 's', updatedAt: 1 }
  await writeUnitJournal(io, home, journal)
  expect(await readUnitJournal(io, home, journal.unitId)).toEqual(journal)
  expect(unitJournalPath(home, journal.unitId).split(/[\\/]/).pop()).not.toContain(':')
})

it('write refuses a backwards/terminal phase once a journal exists, and accepts the same phase', async () => {
  const home = await tempRoot('dsh-unit-journal-transition-')
  const io = nodeEvolutionIo()
  const base: UnitJournal = { schemaVersion: 1, unitId: 'run-2:abc', runId: 'run-2', planDigest: 'd2', target: 'alpha', sources: [], phase: 'target-written', storageKey: 'k2', snapshotSha256: 'a'.repeat(64), updatedAt: 1 }
  await writeUnitJournal(io, home, base)
  await expect(writeUnitJournal(io, home, { ...base, phase: 'prepared' })).rejects.toThrow(/nonmonotonic|terminal/)
  await expect(writeUnitJournal(io, home, { ...base, phase: 'target-written' })).resolves.toBeTruthy()
  await writeUnitJournal(io, home, { ...base, phase: 'committed' })
  await expect(writeUnitJournal(io, home, { ...base, phase: 'target-written' })).rejects.toThrow(/terminal/)
})

it('keeps unitId stable while the nested journal key is separate', async () => {
  const home = await tempRoot('dsh-unit-journal-nested-')
  const io = nodeEvolutionIo()
  const journal: UnitJournal = { schemaVersion: 1, unitId: 'run-3:abc', journalId: 'j-nested', runId: 'run-3', planDigest: 'd3', target: 'alpha', sources: [], phase: 'prepared', storageKey: 'k3', snapshotSha256: 'b'.repeat(64), updatedAt: 1 }
  await writeUnitJournal(io, home, journal)
  expect(await readUnitJournal(io, home, 'j-nested')).toEqual(journal)
  expect(unitJournalPath(home, 'run-3:abc')).not.toBe(unitJournalPath(home, 'j-nested'))
})
