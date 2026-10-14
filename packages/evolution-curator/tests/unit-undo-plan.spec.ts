// @tier ci-only
/** G3a 纯函数夹具：单元撤销的决策必须按 (baseline, 最老 after, 最新 after) 三元组走。 */
import { expect, it } from 'vitest'
import { BASELINE_ACTION, type SkillVersion } from '@deepseek-ai/dsh-evolution-core'
import { newestUnitId, planUnitUndo } from '../src/unit-undo-plan.ts'

const entry = (over: Partial<SkillVersion>): SkillVersion => ({ v: 1, at: 't', action: 'restructure', hash: 'h', chars: 1, ...over })

it('取最新单元：尾部向前找第一条带 unitId 的条目', () => {
  const versions = [entry({ v: 1 }), entry({ v: 2, unitId: 'u-a' }), entry({ v: 3 }), entry({ v: 4, unitId: 'u-b' })]
  expect(newestUnitId(versions)).toBe('u-b')
  expect(newestUnitId([entry({ v: 1 })])).toBeUndefined()
})

it('同一路径：回滚目标是本单元的 baseline，而不是最新那条的 beforeHash（半拆状态的来源）', () => {
  const versions = [
    entry({ v: 1, unitId: 'u-a', action: BASELINE_ACTION, path: 'references/x.md', hash: 'blob-before' }),
    entry({ v: 2, unitId: 'u-a', path: 'references/x.md', hash: 'blob-mid', beforeHash: 'blob-mid-before' }),
    entry({ v: 3, unitId: 'u-a', path: 'references/x.md', hash: 'blob-after', beforeHash: 'blob-mid' }),
  ]
  const plan = planUnitUndo(versions, versions)
  expect(plan.refusals).toEqual([])
  expect(plan.ops).toHaveLength(1)
  expect(plan.ops[0]?.remove).toBe(false)
  expect(plan.ops[0]?.preUnitHash).toBe('blob-before')
  expect(plan.ops[0]?.expectedHash).toBe('blob-after')
})

it('没有 baseline 的路径＝本单元创建 ⇒ 标记为删除，锚定最新 after 的哈希', () => {
  const versions = [entry({ v: 1, unitId: 'u-a', path: 'references/new.md', hash: 'blob-new' })]
  const plan = planUnitUndo(versions, versions)
  expect(plan.ops[0]?.remove).toBe(true)
  expect(plan.ops[0]?.expectedHash).toBe('blob-new')
})

it('正文：取 baseline；无 baseline 时退回最老 after 的 beforeHash', () => {
  const withBaseline = [entry({ v: 1, unitId: 'u-a', action: BASELINE_ACTION, hash: 'body-before' }), entry({ v: 2, unitId: 'u-a', hash: 'body-after', beforeHash: 'body-mid' })]
  expect(planUnitUndo(withBaseline, withBaseline).bodyPreUnitHash).toBe('body-before')
  const withoutBaseline = [entry({ v: 1, unitId: 'u-a', hash: 'body-after', beforeHash: 'body-prev' })]
  expect(planUnitUndo(withoutBaseline, withoutBaseline).bodyPreUnitHash).toBe('body-prev')
})
