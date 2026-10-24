// @tier pre-tag
import { expect, it } from 'vitest'
import { applyRowWrite } from '../src/domain/row-tx.ts'
import type { SkippedRowV3, V3Row, VerifyRowV3 } from '../src/domain/row-v3.ts'

const base = { id: 'r', pairKey: 'a|b', a: 'a', b: 'b', version: 0, createdAt: 'c', updatedAt: 'c', origin: 'agent' as const, attempts: 0 }
const verify: VerifyRowV3 = { ...base, state: 'verify', verifySubState: 'unverified' }
const skipped: SkippedRowV3 = { ...base, id: 's', state: 'skipped', reason: 'kept' }

it('creates only verify/unverified or skipped at version 0', () => {
  const first = applyRowWrite([], { kind: 'createVerify', row: verify }, 'now')
  expect(first.ok).toBe(true)
  if (first.ok) expect(first.rows).toHaveLength(1)
  expect(applyRowWrite([verify], { kind: 'createVerify', row: { ...verify } }, 'now')).toMatchObject({ ok: false, code: 'row-duplicate' })
  expect(applyRowWrite([], { kind: 'createVerify', row: { ...verify, verifySubState: 'candidate' } }, 'now')).toMatchObject({ ok: false, code: 'row-invalid' })
  expect(applyRowWrite([], { kind: 'createSkipped', row: skipped }, 'now').ok).toBe(true)
})

it('transitions and deletes only through transitionV3', () => {
  const decision = { shouldMerge: true, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }
  const moved = applyRowWrite([verify], { kind: 'transition', id: 'r', event: { type: 'verify-passed', decision, target: 'a' }, expectedVersion: 0 }, 'now')
  expect(moved.ok).toBe(true)
  if (moved.ok) expect(moved.row).toMatchObject({ state: 'pending', version: 1 })
  expect(applyRowWrite([verify], { kind: 'transition', id: 'r', event: { type: 'committed', unitId: 'u' }, expectedVersion: 0 }, 'now')).toMatchObject({ ok: false, code: 'illegal-transition' })
  expect(applyRowWrite([verify], { kind: 'transition', id: 'r', event: { type: 'superseded' }, expectedVersion: 1 }, 'now')).toMatchObject({ ok: false, code: 'version-conflict' })
  expect(applyRowWrite([skipped as V3Row], { kind: 'transition', id: 's', event: { type: 'restored' }, expectedVersion: 0 }, 'now')).toMatchObject({ ok: true, row: null, rows: [] })
})
