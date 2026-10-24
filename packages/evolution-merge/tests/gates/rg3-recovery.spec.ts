// @tier pre-tag
import { unlink } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, readUnitJournal, UnitTransactions, unitEvidencePath, writeUnitJournal, writeUnitReceipt, type UnitBackend, type UnitPlan } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { recoverCommitJournals } from '../../src/commit-recovery.ts'
import { writeJournal } from '../../src/domain/commit-journal-store.ts'

function backend(tree: Map<string, string>): UnitBackend {
  return {
    async readSkill(name) { return tree.get(name) ?? null },
    async readSupportFile() { return null },
    async commit(plan, onPhase) { await onPhase?.('target-pending'); tree.set(plan.target, plan.body); await onPhase?.('target-written'); await onPhase?.('source-archiving', { source: 'beta' }); tree.delete('beta'); await onPhase?.('sources-archived'); return { ok: true, message: 'merged', archived: ['beta'], mutations: 2 } },
    async restoreTarget(name, body) { if (body === null) tree.delete(name); else tree.set(name, body) },
    async restoreSource(name, body) { tree.set(name, body) },
  }
}
const plan: UnitPlan = { runId: 'run-1', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [{ name: 'beta', body: 'beta' }], origin: 'foreground', summary: 's' }

it('finalizes committed evidence from snapshot+journal', async () => {
  const home = await tempRoot('dsh-rg3-rec-finalize-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const committed = await tx.commit(prepared.prepared)
  if (!committed.ok) throw new Error(committed.message)
  await unlink(unitEvidencePath(home, prepared.prepared.unitId))
  const finalized = await tx.finalize(prepared.prepared.unitId)
  expect(finalized.ok && finalized.evidence.target.after === 'new').toBe(true)
  expect((await readUnitJournal(nodeEvolutionIo(), home, prepared.prepared.unitId))?.phase).toBe('committed')
})


it('rolls forward target-written without commit', async () => {
  const home = await tempRoot('dsh-rg3-rec-forward-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const journal = await readUnitJournal(nodeEvolutionIo(), home, prepared.prepared.unitId)
  if (journal === null) throw new Error('journal missing')
  tree.set('alpha', 'new'); tree.delete('beta')
  await writeUnitJournal(nodeEvolutionIo(), home, { ...journal, phase: 'target-written', checkpoints: [{ source: 'beta', phase: 'archived', hash: 'h', at: 1 }], updatedAt: 2 })
  const rolled = await tx.rollForward(prepared.prepared.unitId)
  expect(rolled.ok && rolled.evidence.sources[0]?.archived === true).toBe(true)
})

it('rolls back source-archiving from snapshot', async () => {
  const home = await tempRoot('dsh-rg3-rec-rollback-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const journal = await readUnitJournal(nodeEvolutionIo(), home, prepared.prepared.unitId)
  if (journal === null) throw new Error('journal missing')
  tree.set('alpha', 'new'); tree.delete('beta')
  await writeUnitJournal(nodeEvolutionIo(), home, { ...journal, phase: 'source-archiving', checkpoints: [], updatedAt: 2 })
  const rolled = await tx.rollback({ unitId: prepared.prepared.unitId, reason: 'crash' })
  expect(rolled.ok && tree.get('alpha') === 'old' && tree.get('beta') === 'beta').toBe(true)
  expect((await readUnitJournal(nodeEvolutionIo(), home, prepared.prepared.unitId))?.phase).toBe('rolled-back')
})

it('refuses rollback when the tree drifted from the snapshot', async () => {
  const home = await tempRoot('dsh-rg3-rec-drift-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  tree.set('alpha', 'drifted')
  const rolled = await tx.rollback({ unitId: prepared.prepared.unitId, reason: 'drift' })
  expect(rolled.ok).toBe(false)
  if (rolled.ok) return
  expect(rolled.code).toBe('unit-rollback-blocked')
})

it('refuses roll-forward when a source checkpoint is missing', async () => {
  const home = await tempRoot('dsh-rg3-rec-checkpoint-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const journal = await readUnitJournal(nodeEvolutionIo(), home, prepared.prepared.unitId)
  if (journal === null) throw new Error('journal missing')
  tree.set('alpha', 'new')
  await writeUnitJournal(nodeEvolutionIo(), home, { ...journal, phase: 'sources-archived', checkpoints: [], updatedAt: 2 })
  const rolled = await tx.rollForward(prepared.prepared.unitId)
  expect(rolled.ok).toBe(false)
  if (rolled.ok) return
  expect(rolled.code).toBe('unit-rollback-blocked')
})

it('reports receipt-missing for a committed legacy journal without receipt', async () => {
  const home = await tempRoot('dsh-rg3-rec-receipt-')
  const io = nodeEvolutionIo()
  await writeJournal(io, home, { runId: 'run-r', target: 'alpha', create: false, sources: [], phase: 'committed', updatedAt: new Date(1).toISOString() })
  const reports = await recoverCommitJournals(io, home, 2)
  expect(reports.find(item => item.runId === 'run-r')).toMatchObject({ action: 'receipt-missing', ok: false })
})

it('refuses manual recovery before any tree write', async () => {
  const home = await tempRoot('dsh-rg3-rec-manual-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: backend(tree), claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const rolled = await tx.rollForward(prepared.prepared.unitId)
  expect(rolled.ok).toBe(false)
  if (rolled.ok) return
  expect(rolled.code).toBe('unit-rollback-blocked')
})
