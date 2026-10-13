/**
 * G3b / A19：单元成员解析的判据 M1-M5。纯函数 + 合成索引，不依赖真实 home。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SkillVersion } from '../src/skill-history.ts'
import { candidateSkills, resolveUnitMembersFromIndexes, unitMembersAreComplete } from '../src/unit-members.ts'

const entry = (over: Partial<SkillVersion>): SkillVersion => ({ v: 1, at: 't', action: 'restructure', hash: 'h', chars: 1, ...over })
const indexes = (rows: Array<[string, string | null]>) => new Map(rows)
const parse = (text: string): readonly SkillVersion[] => JSON.parse(text) as SkillVersion[]

const head = { skill: 'head-skill', unitId: 'u1', sources: [{ skill: 'head-skill' }, { skill: 'other-skill' }] }

describe('resolveUnitMembers', () => {
  it('M1：解析器不含目录枚举调用（源码级判据）', () => {
    const source = readFileSync('packages/evolution/evolution-core/src/unit-members.ts', 'utf8')
    for (const forbidden of ['readdir', 'discoverSkillFiles', 'treeNames']) expect(source.includes(forbidden)).toBe(false)
  })

  it('M2：sources[] 含 head 自身时，head 的条目只算一次', () => {
    expect(candidateSkills(head)).toEqual(['head-skill', 'other-skill'])
    const members = resolveUnitMembersFromIndexes(head, indexes([
      ['head-skill', JSON.stringify([entry({ v: 1, unitId: 'u1' })])],
      ['other-skill', JSON.stringify([entry({ v: 2, unitId: 'u1' })])],
    ]), parse)
    expect(members.members.map((m) => m.skill)).toEqual(['head-skill', 'other-skill'])
    expect(members.conflicts.filter((c) => c.kind === 'duplicated')).toEqual([])
  })

  it('M3：index-absent 与 unit-absent 分开报且点名技能', () => {
    const members = resolveUnitMembersFromIndexes(head, indexes([
      ['head-skill', JSON.stringify([entry({ v: 1, unitId: 'u1' })])],
      ['other-skill', null],
    ]), parse)
    expect(members.missing).toEqual([{ skill: 'other-skill', reason: 'index-absent' }])
    const absent = resolveUnitMembersFromIndexes(head, indexes([
      ['head-skill', JSON.stringify([entry({ v: 1, unitId: 'u1' })])],
      ['other-skill', JSON.stringify([entry({ v: 3, unitId: 'u9' })])],
    ]), parse)
    expect(absent.missing).toEqual([{ skill: 'other-skill', reason: 'unit-absent' }])
  })

  it('M4：三向冲突各点名 path', () => {
    const manifest = { moves: [{ path: 'references/a.md' }, { path: 'references/b.md' }] }
    const withManifest = { ...head, unitHead: manifest as never }
    const members = resolveUnitMembersFromIndexes(withManifest, indexes([
      ['head-skill', JSON.stringify([entry({ v: 1, unitId: 'u1', unitHead: { moves: [{ path: 'references/a.md' }] } })])],
      ['other-skill', JSON.stringify([entry({ v: 2, unitId: 'u1', unitHead: { moves: [{ path: 'references/z.md' }] } })])],
    ]), parse)
    expect(members.conflicts).toEqual([
      { kind: 'missing', path: 'references/b.md' },
      { kind: 'foreign', path: 'references/z.md' },
    ])
    expect(unitMembersAreComplete(members)).toBe(false)
    expect(unitMembersAreComplete({ members: [], missing: [], conflicts: [] })).toBe(true)
  })

  it('M5：顺序确定（sources[] 原序），同输入两次结果逐字节相同', () => {
    const input = indexes([
      ['head-skill', JSON.stringify([entry({ v: 1, unitId: 'u1' })])],
      ['other-skill', JSON.stringify([entry({ v: 2, unitId: 'u1' })])],
    ])
    const once = JSON.stringify(resolveUnitMembersFromIndexes(head, input, parse))
    const twice = JSON.stringify(resolveUnitMembersFromIndexes(head, input, parse))
    expect(once).toBe(twice)
    expect(JSON.parse(once).members.map((m: { skill: string }) => m.skill)).toEqual(['head-skill', 'other-skill'])
  })
})
