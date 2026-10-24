// @tier pre-tag

import { expect, it } from 'vitest'
import { nodeEvolutionIo, UnitTransactions, type UnitBackend, type UnitPlan } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'

function backend(tree: Map<string, string>): UnitBackend {
  return {
    async readSkill(name) { return tree.get(name) ?? null },
    async readSupportFile() { return null },
    async commit(plan) { tree.set(plan.target, plan.body); tree.delete('beta'); return { ok: true, message: 'merged', archived: ['beta'], mutations: 2 } },
    async restoreTarget(name, body) { if (body === null) tree.delete(name); else tree.set(name, body) },
    async restoreSource(name, body) { tree.set(name, body) },
  }
}
const plan: UnitPlan = { runId: 'run-1', pairKey: 'alpha|beta', target: 'alpha', targetExists: true, sources: ['beta'], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [{ name: 'beta', body: 'beta' }], origin: 'foreground', summary: 's' }

it('replays same digest without a second mutation and rejects a different digest', async () => {
  const home = await tempRoot('dsh-rg3-idem-')
  const tree = new Map<string, string>([['alpha', 'old'], ['beta', 'beta']])
  let writes = 0
  const base = backend(tree)
  const counted: UnitBackend = { ...base, async commit(p) { writes += 1; return await base.commit(p) } }
  const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: counted, claim: { async acquire() { return { async release() {} } } }, now: () => 1 })
  const prepared = await tx.prepare(plan)
  if (!prepared.ok) throw new Error(prepared.message)
  const first = await tx.commit(prepared.prepared)
  const replay = await tx.commit(prepared.prepared)
  expect(first.ok && replay.ok).toBe(true)
  expect(writes).toBe(1)
  const conflict = await tx.commit({ unitId: prepared.prepared.unitId, planDigest: 'other' })
  expect(conflict.ok).toBe(false)
  if (conflict.ok) return
  expect(conflict.code).toBe('unit-conflict')
})
