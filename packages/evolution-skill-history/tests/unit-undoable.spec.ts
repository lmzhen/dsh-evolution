/** G3b：undoable 是**单元**属性 —— 同单元的条目必须同值（U1，今天必红的那条）。 */
import { expect, it } from 'vitest'
import type { SkillVersion } from '@deepseek-ai/dsh-evolution-core'
import { undoableFor, unitUndoableFlags } from '../src/unit-undoable.ts'

const entry = (over: Partial<SkillVersion>): SkillVersion => ({ v: 1, at: 't', action: 'restructure', hash: 'h', chars: 1, ...over })

it('U1：同 unitId 的条目共用一个 undoable（任一成员与活体不同 ⇒ 整单元可撤销）', () => {
  const members = [
    entry({ v: 1, unitId: 'u1', hash: 'live', path: 'SKILL.md' }),
    entry({ v: 2, unitId: 'u1', hash: 'other', path: 'references/x.md' }),
  ]
  const flags = unitUndoableFlags(members, 'live')
  expect(flags.get('u1')).toBe(true)
  expect(undoableFor(members[0] as SkillVersion, flags, 'live')).toBe(true)
  expect(undoableFor(members[1] as SkillVersion, flags, 'live')).toBe(true)
})

it('U1b：单元整体已是当前（所有成员都等于活体）⇒ 整单元 false', () => {
  const members = [entry({ v: 1, unitId: 'u2', hash: 'live' }), entry({ v: 2, unitId: 'u2', hash: 'live' })]
  const flags = unitUndoableFlags(members, 'live')
  expect(flags.get('u2')).toBe(false)
})

it('无 unitId 的条目退回逐条判定（老条目是单例单元）', () => {
  const flags = unitUndoableFlags([entry({ v: 9, hash: 'x' })], 'live')
  expect(flags.size).toBe(0)
  expect(undoableFor(entry({ v: 9, hash: 'x' }), flags, 'live')).toBe(true)
  expect(undoableFor(entry({ v: 9, hash: 'live' }), flags, 'live')).toBe(false)
})
