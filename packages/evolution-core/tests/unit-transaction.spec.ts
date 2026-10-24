// @tier pre-tag
import { unlink } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { unitEvidencePath } from '@deepseek-ai/dsh-evolution-core'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { UnitTransactions, type UnitBackend, type UnitPlan } from '../src/unit-transaction.ts'
import { readUnitJournal, writeUnitJournal } from '../src/unit-journal.ts'

function backend(tree: Map<string, string>): UnitBackend {
  return {
    async readSkill(name) { return tree.get(name) ?? null },
    async readSupportFile() { return null },
    async commit(plan, onPhase) { await onPhase?.('target-pending'); tree.set(plan.target, plan.body); await onPhase?.('target-written'); await onPhase?.('source-archiving', { source: 'beta' }); tree.delete('beta'); await onPhase?.('sources-archived'); return { ok: true, message: 'merged', archived: ['beta'], mutations: 2 } },
    async restoreTarget(name, body) { if (body === null) tree.delete(name); else tree.set(name, body) },
    async restoreSource(name, body) { tree.set(name, body) },
  }
}
function plan(body = 'new'): UnitPlan {
  return { runId: 'run-1', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body, supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [{ name: 'beta', body: 'beta' }], origin: 'foreground', summary: 's' }
}

it('prepares, commits and returns stored evidence', async () => {
  const home = await tempRoot('dsh-unit-tx-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan())
  expect(prepared.ok).toBe(true)
  if (!prepared.ok) return
  const committed = await tx.commit(prepared.prepared)
  expect(committed.ok).toBe(true)
  if (!committed.ok) return
  expect(committed.evidence.target.after).toBe('new')
  expect(await tx.verify({ unitId: prepared.prepared.unitId })).toEqual(committed.evidence)
  const journal = await readUnitJournal(io, home, prepared.prepared.unitId)
  expect(journal?.phase).toBe('committed')
  expect(journal?.checkpoints?.map(item => item.source)).toEqual(['beta'])
})

it('replays the same digest idempotently and rejects a different one', async () => {
  const home = await tempRoot('dsh-unit-tx-idem-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  const first = await tx.commit(prepared.prepared)
  if (!first.ok) throw new Error(first.message)
  const replay = await tx.commit(prepared.prepared)
  expect(replay.ok).toBe(true)
  if (!replay.ok) return
  expect(replay.evidence.unitId).toBe(first.evidence.unitId)
  const conflict = await tx.commit({ unitId: prepared.prepared.unitId, planDigest: 'other' })
  expect(conflict.ok).toBe(false)
  if (conflict.ok) return
  expect(conflict.code).toBe('unit-conflict')
})

it('finalizes missing evidence from snapshot + committed journal', async () => {
  const home = await tempRoot('dsh-unit-tx-finalize-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  const committed = await tx.commit(prepared.prepared)
  if (!committed.ok) throw new Error(committed.message)
  await unlink(unitEvidencePath(home, prepared.prepared.unitId))
  const finalized = await tx.finalize(prepared.prepared.unitId)
  expect(finalized.ok).toBe(true)
  if (!finalized.ok) return
  expect(finalized.evidence.target.after).toBe('new')
  expect(finalized.evidence.sources[0]?.archived).toBe(true)
})

it('rolls forward a target-written unit without re-running commit', async () => {
  const home = await tempRoot('dsh-unit-tx-rollforward-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  const journal = await readUnitJournal(io, home, prepared.prepared.unitId)
  if (journal === null) throw new Error('journal missing')
  tree.set('alpha', 'new')
  tree.delete('beta')
  await writeUnitJournal(io, home, { ...journal, phase: 'target-written', checkpoints: [{ source: 'beta', phase: 'archived', hash: 'h', at: 1 }], updatedAt: 2 })
  const rolled = await tx.rollForward(prepared.prepared.unitId)
  expect(rolled.ok).toBe(true)
  if (!rolled.ok) return
  expect(rolled.evidence.target.after).toBe('new')
  expect(rolled.evidence.sources[0]?.archived).toBe(true)
})

it('exposes journal phases for fault injection', async () => {
  const home = await tempRoot('dsh-unit-tx-hook-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const phases: string[] = []
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1, onPhase: phase => { phases.push(phase) } })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  await tx.commit(prepared.prepared)
  expect(phases).toEqual(['prepared', 'target-pending', 'target-written', 'source-archiving', 'sources-archived', 'committed'])
})

it('does not double-write when two commits race for one unit', async () => {
  const home = await tempRoot('dsh-unit-tx-race-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  let writes = 0
  const base = backend(tree)
  const raceBackend: UnitBackend = { ...base, async commit(plan) { writes += 1; return await base.commit(plan) } }
  const tx = new UnitTransactions({ io, home, backend: raceBackend, claim: { async acquire() { return { async release() {} } } }, now: () => 1, waitMs: 2000 })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  const [first, second] = await Promise.all([tx.commit(prepared.prepared), tx.commit(prepared.prepared)])
  expect(writes).toBe(1)
  expect(first.ok || second.ok).toBe(true)
})

it('rolls forward a sources-archived unit with checkpoints', async () => {
  const home = await tempRoot('dsh-unit-tx-sources-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  const journal = await readUnitJournal(io, home, prepared.prepared.unitId)
  if (journal === null) throw new Error('journal missing')
  tree.set('alpha', 'new')
  tree.delete('beta')
  await writeUnitJournal(io, home, { ...journal, phase: 'sources-archived', checkpoints: [{ source: 'beta', phase: 'archived', hash: 'h', at: 1 }], updatedAt: 2 })
  const rolled = await tx.rollForward(prepared.prepared.unitId)
  expect(rolled.ok).toBe(true)
  if (!rolled.ok) return
  expect(rolled.evidence.sources[0]?.archived).toBe(true)
})

it('rolls back from source-archiving using snapshot before', async () => {
  const home = await tempRoot('dsh-unit-tx-source-rollback-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  const journal = await readUnitJournal(io, home, prepared.prepared.unitId)
  if (journal === null) throw new Error('journal missing')
  tree.set('alpha', 'new')
  tree.delete('beta')
  await writeUnitJournal(io, home, { ...journal, phase: 'source-archiving', checkpoints: [], updatedAt: 2 })
  const rolled = await tx.rollback({ unitId: prepared.prepared.unitId, reason: 'crash' })
  expect(rolled.ok).toBe(true)
  expect(tree.get('alpha')).toBe('old')
  expect(tree.get('beta')).toBe('beta')
})

it('refuses roll-forward before any tree write', async () => {
  const home = await tempRoot('dsh-unit-tx-manual-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  const result = await tx.rollForward(prepared.prepared.unitId)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.code).toBe('unit-rollback-blocked')
})

it('rolls back an uncommitted target from the snapshot', async () => {
  const home = await tempRoot('dsh-unit-tx-rollback-')
  const io = nodeEvolutionIo()
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io, home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan())
  if (!prepared.ok) throw new Error(prepared.message)
  tree.set('alpha', 'new')
  const rolled = await tx.rollback({ unitId: prepared.prepared.unitId, reason: 'test' })
  expect(rolled.ok).toBe(true)
  expect(tree.get('alpha')).toBe('old')
})
