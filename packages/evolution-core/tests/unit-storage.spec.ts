// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { readUnitEvidence, readUnitIndex, readUnitSnapshot, unitEvidencePath, unitSnapshotPath, unitStorageKey, writeUnitEvidence, writeUnitSnapshot, type UnitEvidenceRecord, type UnitSnapshot } from '../src/unit-storage.ts'

it('maps opaque unitId to a Windows-safe storage key without path separators', () => {
  const unitId = 'run-1/pairs/abc:deadbeef'
  const key = unitStorageKey(unitId)
  expect(key).toMatch(/^[0-9a-f]{64}$/)
  expect(unitSnapshotPath('C:/home', unitId)).not.toContain(':deadbeef')
  expect(unitEvidencePath('C:/home', unitId)).not.toContain('run-1/pairs')
})

it('persists snapshot, evidence and index atomically enough for replay', async () => {
  const home = await tempRoot('dsh-unit-storage-')
  const io = nodeEvolutionIo()
  const unitId = 'run-1/pairs/abc:deadbeef'
  const snapshot: UnitSnapshot = { schemaVersion: 1, unitId, planDigest: 'd1', runId: 'run-1', target: 'alpha', targetExists: true, targetBefore: 'old', supportBefore: [{ path: 'references/a.md', content: null }], supportAfter: [{ path: 'references/a.md', content: 'new' }], sourceBefore: [{ name: 'beta', body: 'beta' }], origin: 'foreground', summary: 's', createdAt: 1 }
  await writeUnitSnapshot(io, home, snapshot)
  expect(await readUnitSnapshot(io, home, unitId)).toEqual(snapshot)
  const evidence: UnitEvidenceRecord = { schemaVersion: 1, unitId, runId: 'run-1', planDigest: 'd1', state: 'complete', target: { before: 'old', after: 'new', supportDigest: 'sd', created: false }, sources: [{ name: 'beta', before: 'beta', after: null, archived: true, absorbedInto: 'alpha' }], mutations: 2, at: 2 }
  await writeUnitEvidence(io, home, evidence)
  expect(await readUnitEvidence(io, home, unitId)).toEqual(evidence)
  expect((await readUnitIndex(io, home)).find(item => item.unitId === unitId)?.storageKey).toBe(unitStorageKey(unitId))
})
