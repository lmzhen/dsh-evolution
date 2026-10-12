/*
 * G1 验收 V1–V4：引擎语义（契约 §3）。
 * 这些断言刻意只碰**纯函数**：严重度是规则自带的静态值、一条规则至多一条 finding、count 必须存在、
 * 差分按 (rule,count) 而不是按名字、读不到内容时给出 error 而不是沉默。
 */
import { describe, expect, it } from 'vitest'
import { diffFindings, lintSkill, RULES, type LintFacts } from '../src/skill-lint.ts'

const facts = (over: Partial<LintFacts> = {}): LintFacts => ({
  skillName: 'demo',
  dims: {
    bodyChars: 1_000,
    bodyTokens: 250,
    stampDensityPerKb: null,
    stampHits: null,
    supportGroups: 1,
    supportFiles: 0,
    churnPatches: null,
    churnReads: null,
  },
  softLineChars: 24_000,
  overSoftLine: false,
  overTwiceSoftLine: false,
  stampLimitPerKb: 1,
  churnMinPatches: 20,
  readable: true,
  ...over,
})

describe('skill-lint（G1 V1–V4）', () => {
  it('V1 严重度是规则自带的静态值，且只有 body-oversize-2x 是 error', () => {
    const errors = RULES.filter(r => r.severity === 'error').map(r => r.id)
    expect(errors).toEqual(['unreadable-skill', 'body-oversize-2x'])
    for (const rule of RULES) expect(['warn', 'error']).toContain(rule.severity)
  })

  it('V1 健康事实不产出任何 finding（空集是合法结论）', () => {
    expect(lintSkill(facts())).toEqual([])
  })

  it('V1 一条规则至多一条 finding，且 count 必存在', () => {
    const out = lintSkill(facts({ overSoftLine: true, overTwiceSoftLine: true, dims: { ...facts().dims, bodyChars: 60_000 } }))
    const ids = out.map(f => f.rule)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of out) expect(typeof f.count).toBe('number')
    expect(ids).toContain('body-oversize-2x')
    expect(ids).not.toContain('body-oversize')
  })

  it('V4 读不到内容时给 error，而不是沉默', () => {
    const out = lintSkill(facts({ readable: false }))
    expect(out.map(f => f.rule)).toContain('unreadable-skill')
    expect(out.find(f => f.rule === 'unreadable-skill')?.severity).toBe('error')
  })

  it('V2 差分按 (rule,count)：1 处恶化到 9 处必须报 worsened', () => {
    const before = [{ severity: 'warn' as const, rule: 'stamp-density', message: 'x', count: 1 }]
    const after = [{ severity: 'warn' as const, rule: 'stamp-density', message: 'x', count: 9 }]
    const d = diffFindings(before, after)
    expect(d.worsened.map(f => f.rule)).toEqual(['stamp-density'])
    expect(d.introduced).toEqual([])
    expect(d.resolved).toEqual([])
  })

  it('V2 新出现与消失各自归位', () => {
    const a = [{ severity: 'warn' as const, rule: 'write-ghost', message: 'x', count: 2 }]
    const b = [{ severity: 'warn' as const, rule: 'stamp-density', message: 'y', count: 3 }]
    const d = diffFindings(a, b)
    expect(d.introduced.map(f => f.rule)).toEqual(['stamp-density'])
    expect(d.resolved).toEqual(['write-ghost'])
  })

  it('V3 支撑文件未知（null）时 references-sprawl 不判定（不得以 0 冒充）', () => {
    const unknown = facts({ dims: { ...facts().dims, supportFiles: null } })
    expect(lintSkill(unknown).map(f => f.rule)).not.toContain('references-sprawl')
  })
})
