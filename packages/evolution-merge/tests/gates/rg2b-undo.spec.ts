// @tier pre-tag
import { expect, it } from 'vitest'
import { contentHash, nodeEvolutionIo, type SkillVersion, type UnitEvidenceRecord } from '@deepseek-ai/dsh-evolution-core'
import { writeUnitEvidence } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { writeCommitReceipt, readCommitReceipt } from '../../src/commit-receipt.ts'
import { runUndoOperation } from '../../src/undo-operation.ts'
import { evidenceSha256 } from '../../src/domain/evidence-hash.ts'
import { recordPair } from '../../src/domain/pair-index-store.ts'
import { readRunMeta, writeRunMeta } from '../../src/domain/run-coordinator.ts'
import { readUndoReceipt } from '../../src/domain/undo-receipt.ts'
import type { MergeUndoPort } from '../../src/undo-merge.ts'
import { loadPairIndex } from '../../src/domain/pair-index-store.ts'

const AT = '2026-10-20T00:00:00.000Z'
const version = (v: number, action: string, hash: string, beforeHash?: string): SkillVersion => ({ v, at: AT, unitId: 'u-1', action, hash, chars: 1, ...(beforeHash === undefined ? {} : { beforeHash }) })
const evidence: UnitEvidenceRecord = { schemaVersion: 1, unitId: 'u-1', runId: 'run-1', planDigest: 'd', state: 'complete', target: { before: 'body-0', after: 'body-1', supportDigest: '', created: false }, sources: [{ name: 'source', before: 'src', after: null, archived: true, absorbedInto: 'target' }], mutations: 1, at: 1 }

function port(state: { target: string | null; source: string | null; calls: string[] }): MergeUndoPort {
  return {
    async listVersions(skill) { return skill === 'target' ? [version(1, 'baseline', contentHash('body-0')), version(2, 'merge', contentHash('body-1'), contentHash('body-0'))] : [version(3, 'archive', contentHash('src'))] },
    async readSkill(skill) { return skill === 'target' ? state.target : state.source },
    async readSupport() { return null },
    async readBlob(hash) { return hash === contentHash('body-0') ? 'body-0' : null },
    async hasArchived() { return state.source === null },
    async restoreFromArchive() { state.source = 'src'; state.calls.push('restore-source'); return { ok: true, message: 'restored' } },
    async archive(skill) { state.target = null; state.calls.push('archive:' + skill); return { ok: true, message: 'archived' } },
    async updateSkill(_skill, body) { state.target = body; state.calls.push('update-target'); return { ok: true, message: 'updated' } },
    async writeSupportFile() { return { ok: true, message: 'written' } },
    async removeSupportFile() { return { ok: true, message: 'removed' } },
  }
}
async function setup(create = false): Promise<{ home: string; io: ReturnType<typeof nodeEvolutionIo>; state: { target: string | null; source: string | null; calls: string[] } }> {
  const home = await tempRoot('dsh-rg2b-undo-')
  const io = nodeEvolutionIo()
  const ev = { ...evidence, ...(create ? { target: { ...evidence.target, before: null, created: true } } : {}) }
  await writeUnitEvidence(io, home, ev)
  const receipt = { runId: 'run-1', unitId: 'u-1', evidenceSha256: evidenceSha256(ev), target: 'target', create, sources: ['source'], archived: ['source'], at: 1, pairKey: 'a\u0000b' }
  await writeCommitReceipt(io, home, receipt)
  await recordPair(io, home, { pairKey: 'a\u0000b', runId: 'run-1', result: 'merged', target: 'target' })
  await writeRunMeta(io, home, { version: 1, runId: 'run-1', phase: 'settled', pairCount: 1, createdAt: AT, updatedAt: AT })
  return { home, io, state: { target: create ? 'body-1' : 'body-1', source: null, calls: [] } }
}

it('undoes a committed pair, writes undo receipt and marks the run undone', async () => {
  const { home, io, state } = await setup()
  const result = await runUndoOperation({ io, home, runId: 'run-1', port: port(state), now: () => 2 })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  expect(state.target).toBe('body-0')
  expect(state.source).toBe('src')
  expect(await readUndoReceipt(io, home, 'run-1', 'a\u0000b')).toMatchObject({ restoredTargetHash: contentHash('body-0') })
  expect((await readRunMeta(io, home, 'run-1'))?.phase).toBe('undone')
  expect((await loadPairIndex(io, home)).get('a\u0000b')?.result).toBe('undone')
})

it('undoes all pairs of one run and target in reverse order', async () => {
  const home = await tempRoot('dsh-rg2b-undo-multi-')
  const io = nodeEvolutionIo()
  const ev1: UnitEvidenceRecord = { ...evidence, unitId: 'u-1', runId: 'run-1', target: { before: 'body-0', after: 'body-1', supportDigest: '', created: false }, sources: [{ name: 'source-1', before: 'src-1', after: null, archived: true, absorbedInto: 'target' }] }
  const ev2: UnitEvidenceRecord = { ...evidence, unitId: 'u-2', runId: 'run-1', target: { before: 'body-1', after: 'body-2', supportDigest: '', created: false }, sources: [{ name: 'source-2', before: 'src-2', after: null, archived: true, absorbedInto: 'target' }] }
  await writeUnitEvidence(io, home, ev1)
  await writeUnitEvidence(io, home, ev2)
  await writeCommitReceipt(io, home, { runId: 'run-1', unitId: 'u-1', evidenceSha256: evidenceSha256(ev1), target: 'target', create: false, sources: ['source-1'], archived: ['source-1'], at: 1, pairKey: 'p1' })
  await writeCommitReceipt(io, home, { runId: 'run-1', unitId: 'u-2', evidenceSha256: evidenceSha256(ev2), target: 'target', create: false, sources: ['source-2'], archived: ['source-2'], at: 2, pairKey: 'p2' })
  await writeRunMeta(io, home, { version: 1, runId: 'run-1', phase: 'settled', pairCount: 2, createdAt: AT, updatedAt: AT })
  const live = new Map<string, string | null>([['target', 'body-2'], ['source-1', null], ['source-2', null]])
  const versions = [version(1, 'baseline', contentHash('body-0')), version(2, 'merge', contentHash('body-1'), contentHash('body-0')), { ...version(3, 'merge', contentHash('body-2'), contentHash('body-1')), unitId: 'u-2' }]
  const multiPort: MergeUndoPort = {
    async listVersions(skill) { return skill === 'target' ? versions : [] },
    async readSkill(skill) { return live.get(skill) ?? null },
    async readSupport() { return null },
    async readBlob(hash) { return hash === contentHash('body-0') ? 'body-0' : hash === contentHash('body-1') ? 'body-1' : null },
    async hasArchived() { return true },
    async restoreFromArchive(skill) { live.set(skill, skill === 'source-1' ? 'src-1' : 'src-2'); return { ok: true, message: 'restored' } },
    async archive(skill) { live.set(skill, null); return { ok: true, message: 'archived' } },
    async updateSkill(_skill, body) { live.set('target', body); return { ok: true, message: 'updated' } },
    async writeSupportFile() { return { ok: true, message: 'written' } },
    async removeSupportFile() { return { ok: true, message: 'removed' } },
  }
  const result = await runUndoOperation({ io, home, runId: 'run-1', target: 'target', port: multiPort, now: () => 3 })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  expect(live.get('target')).toBe('body-0')
  expect(live.get('source-1')).toBe('src-1')
  expect(live.get('source-2')).toBe('src-2')
  expect(result.undone.sort()).toEqual(['p1', 'p2'])
})

it('target create undo archives the target and records null restored hash', async () => {
  const { home, io, state } = await setup(true)
  const result = await runUndoOperation({ io, home, runId: 'run-1', port: port(state), now: () => 2 })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  expect(state.target).toBeNull()
  expect(await readUndoReceipt(io, home, 'run-1', 'a\u0000b')).toMatchObject({ restoredTargetHash: null })
})

it('legacy receipt without evidence is typed unavailable', async () => {
  const home = await tempRoot('dsh-rg2b-legacy-')
  const io = nodeEvolutionIo()
  await writeCommitReceipt(io, home, { runId: 'run-1', unitId: 'u-legacy', target: 'target', create: false, sources: ['source'], archived: ['source'], at: 1 })
  const result = await runUndoOperation({ io, home, runId: 'run-1', port: port({ target: 'body-1', source: null, calls: [] }), now: () => 2 })
  expect(result.ok).toBe(false)
  expect(result.code).toBe('undo-unavailable-legacy-receipt')
})

it('resumes idempotently after a crash at the undo receipt point', async () => {
  const { home, io, state } = await setup()
  let crashedOk = true
  try { await runUndoOperation({ io, home, runId: 'run-1', port: port(state), now: () => 2, onPhase: async phase => { if (phase === 'receipt') throw new Error('kill-before-receipt') } }) } catch { crashedOk = false }
  expect(crashedOk).toBe(false)
  const retried = await runUndoOperation({ io, home, runId: 'run-1', port: port(state), now: () => 3 })
  expect(retried.ok, retried.ok ? '' : retried.message).toBe(true)
  expect(await readUndoReceipt(io, home, 'run-1', 'a\u0000b')).toMatchObject({ restoredTargetHash: contentHash('body-0') })
  expect((await readRunMeta(io, home, 'run-1'))?.phase).toBe('undone')
})

it('resumes settlement after a crash at pair-index write', async () => {
  const { home, io, state } = await setup()
  let crashed = true
  try { await runUndoOperation({ io, home, runId: 'run-1', port: port(state), now: () => 2, onPhase: async phase => { if (phase === 'pair-index' && crashed) { crashed = false; throw new Error('kill-before-pair-index') } } }) } catch { /* expected */ }
  const retried = await runUndoOperation({ io, home, runId: 'run-1', port: port(state), now: () => 3 })
  expect(retried.ok, retried.ok ? '' : retried.message).toBe(true)
  expect((await readRunMeta(io, home, 'run-1'))?.phase).toBe('undone')
})

it('target restored/source not restored is typed partial and writes no receipt', async () => {
  const { home, io, state } = await setup()
  state.target = 'body-0'
  const first = await runUndoOperation({ io, home, runId: 'run-1', port: port(state), now: () => 2 })
  expect(first.ok).toBe(false)
  expect(first.code).toBe('undo-partial-state')
  expect(await readUndoReceipt(io, home, 'run-1', 'a\u0000b')).toBeNull()
  const second = await runUndoOperation({ io, home, runId: 'run-1', port: port(state), now: () => 3 })
  expect(second.ok).toBe(false)
  expect(await readUndoReceipt(io, home, 'run-1', 'a\u0000b')).toBeNull()
})
