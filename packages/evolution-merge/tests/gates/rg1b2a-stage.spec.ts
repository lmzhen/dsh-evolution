// @tier pre-tag
import { expect, it } from 'vitest'
import { admitStage, planApprovedReserved, STAGE_WRITE_ORDER, type StageEntry } from '../../src/domain/stage-aggregate.ts'

const entry = (state: StageEntry['state']): StageEntry => ({ version: 1, rowId: 'r1', pairKey: 'a\u0000b', ref: 'run-1/pairs/r1', state, createdAt: 1, expiresAt: 2, updatedAt: 1 })

it('pins reserved before tree before present and blocks pending/verify', () => {
  expect(STAGE_WRITE_ORDER).toEqual(['index:reserved', 'tree', 'index:present'])
  expect(admitStage('pending')).toMatchObject({ ok: false })
  expect(admitStage('verify')).toMatchObject({ ok: false })
  expect(admitStage('approved')).toEqual({ ok: true })
})

it('continues approved+reserved and fuse+reserved without reallocating', () => {
  expect(planApprovedReserved('approved', entry('reserved'))).toMatchObject({ kind: 'transition-fuse', rowId: 'r1' })
  expect(planApprovedReserved('approved', entry('present'))).toMatchObject({ kind: 'transition-fuse', rowId: 'r1' })
  expect(planApprovedReserved('fuse', entry('reserved'))).toMatchObject({ kind: 'write-present', rowId: 'r1' })
  expect(planApprovedReserved('fuse', entry('present'))).toEqual({ kind: 'none' })
})
