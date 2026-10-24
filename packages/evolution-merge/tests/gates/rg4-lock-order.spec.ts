// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo, UnitTransactions, type UnitBackend, type UnitPlan } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'

it('acquires target claim only at commit, after the tree fence', async () => {
  const home = await tempRoot('dsh-rg4-order-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  const order: string[] = []
  const backend: UnitBackend = {
    async readSkill(n) { return tree.get(n) ?? null }, async readSupportFile() { return null },
    async commit(plan, onPhase) { order.push('write'); tree.set(plan.target, plan.body); tree.delete('beta'); await onPhase?.('sources-archived'); return { ok: true, message: 'merged', archived: ['beta'], mutations: 1 } },
    async restoreTarget() {}, async restoreSource() {},
  }
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend, claim: { async acquire() { return { async release() {} } } }, now: () => 1, onLock: lock => { order.push(lock) } })
  const plan: UnitPlan = { runId: 'run-1', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [{ name: 'beta', body: 'beta' }], origin: 'foreground', summary: 's' }
  const prepared = await tx.prepare(plan)
  expect(order).toEqual([])
  if (!prepared.ok) throw new Error(prepared.message)
  await tx.commit(prepared.prepared)
  expect(order).toEqual(['tree', 'claim', 'write'])
})
