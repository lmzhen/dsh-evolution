// @tier pre-tag
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
    expect(members.members.map(m => m.skill)).toEqual(['head-skill', 'other-skill'])
    expect(members.conflicts.filter(c => c.kind === 'duplicated')).toEqual([])
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

  it('M4b：同一 support path 属于两个技能是正常 extract 形态，不算 duplicated', () => {
    const manifest = { moves: [{ path: 'references/shared.md' }] }
    const withManifest = { ...head, unitHead: manifest as never }
    const members = resolveUnitMembersFromIndexes(withManifest, indexes([
      ['head-skill', JSON.stringify([entry({ v: 1, unitId: 'u1', unitHead: { moves: [{ path: 'references/shared.md' }] } })])],
      ['other-skill', JSON.stringify([entry({ v: 2, unitId: 'u1', unitHead: { moves: [{ path: 'references/shared.md' }] } })])],
    ]), parse)
    expect(members.conflicts).toEqual([])
    expect(unitMembersAreComplete(members)).toBe(true)
  })

  it('M5：顺序确定（sources[] 原序），同输入两次结果逐字节相同', () => {
    const input = indexes([
      ['head-skill', JSON.stringify([entry({ v: 1, unitId: 'u1' })])],
      ['other-skill', JSON.stringify([entry({ v: 2, unitId: 'u1' })])],
    ])
    const once = JSON.stringify(resolveUnitMembersFromIndexes(head, input, parse))
    const twice = JSON.stringify(resolveUnitMembersFromIndexes(head, input, parse))
    expect(once).toBe(twice)
    const parsedOnce = JSON.parse(once) as { members: Array<{ skill: string }> }
    expect(parsedOnce.members.map(m => m.skill)).toEqual(['head-skill', 'other-skill'])
  })

  it('A19.2：io 外壳只按已知 key 打开（索引不可读即 index-absent 并点名）', async () => {
    const { resolveUnitMembers } = await import('../src/unit-members.ts')
    const seen: string[] = []
    const io = { readText: async (path: string) => { seen.push(path); return path.includes('head-skill') ? JSON.stringify([entry({ v: 1, unitId: 'u1' })]) : null } }
    const members = await resolveUnitMembers('ROOT', io, head, (root, name) => root + '/' + name + '/index.json', parse)
    expect(seen).toEqual(['ROOT/head-skill/index.json', 'ROOT/other-skill/index.json'])
    expect(members.members.map(m => m.skill)).toEqual(['head-skill'])
    expect(members.missing).toEqual([{ skill: 'other-skill', reason: 'index-absent' }])
  })
})

describe('landmarkVerdict（跨索引孤路标）', () => {
  const landmark = entry({ v: 3, unitId: 'uL', unitHead: { skill: 'owner' } })

  it('可跳 ⟺ 目标存在 ∧ 其索引仍持该 unitId', async () => {
    const { landmarkVerdict } = await import('../src/unit-members.ts')
    expect(landmarkVerdict(landmark, [entry({ v: 1, unitId: 'uL' })])).toEqual({ jumpable: true })
    expect(landmarkVerdict(landmark, [entry({ v: 1, unitId: 'other' })])).toEqual({ jumpable: false, reason: 'unit-absent' })
    expect(landmarkVerdict(landmark, null)).toEqual({ jumpable: false, reason: 'owner-absent' })
    expect(landmarkVerdict(entry({ v: 4, unitId: 'u1' }), [])).toEqual({ jumpable: false, reason: 'not-a-landmark' })
  })

  it('全库扫描点名孤路标（技能名 ＋ 版本 ＋ 目标 ＋ 原因），可跳的不报', async () => {
    const { staleRouteStubs } = await import('../src/unit-members.ts')
    const corpus = new Map<string, readonly SkillVersion[] | null>([
      ['a-skill', [entry({ v: 1, unitId: 'uL', unitHead: { skill: 'gone' } })]],
      ['b-skill', [entry({ v: 2, unitId: 'uM', unitHead: { skill: 'c-skill' } })]],
      ['c-skill', [entry({ v: 3, unitId: 'uM' })]],
      ['d-skill', null],
    ])
    expect(staleRouteStubs(corpus)).toEqual([
      { skill: 'a-skill', v: 1, owner: 'gone', reason: 'owner-absent' },
    ])
  })
})
