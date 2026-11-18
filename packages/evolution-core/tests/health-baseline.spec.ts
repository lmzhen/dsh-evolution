// @tier fast
/*
 * G1 标定：把两侧语料量成可审计的读数，并检查引擎产物的形状与不变量（契约 §4）。
 *
 * 这个 spec 只做两件事：经 lib-health-corpus 读两侧语料（缺语料就明确记 0，不假绿）、用引擎算基线并校验形状与不变量。
 * 产物由 producer 写（scripts/gen-health-baseline.mjs），门禁只读产物判定 —— 测试不再生产门禁的输入（G4/S2）。
 */
import { describe, expect, it } from 'vitest'
import { buildHealthBaseline } from '../src/health-baseline.ts'
import { RULES } from '../src/skill-lint.ts'
import { collectCorpusSkills } from '../../scripts/lib-health-corpus.mjs'

describe('G1 标定：health-baseline 读数', () => {
  const skills = collectCorpusSkills().skills as Array<{ facts: { dims: { bodyTokens: number | null } } }>
  const baseline = buildHealthBaseline(skills as never)

  it('语料状态是明确的（哪一侧为空一目了然，不假装测过）', () => {
    console.log('corpora: user=' + String(baseline.corpora.user) + ' platform=' + String(baseline.corpora.platform))
    expect(baseline.corpora.user + baseline.corpora.platform).toBe(skills.length)
  })

  it('每条规则都有行，且比率是合法概率', () => {
    for (const rule of RULES) expect(Object.keys(baseline.values)).toContain(rule.id)
    for (const [id, row] of Object.entries(baseline.values)) {
      expect(row.userHitRate, id).toBeGreaterThanOrEqual(0)
      expect(row.userHitRate, id).toBeLessThanOrEqual(1)
    }
  })

  it('空语料不得报出非零比率（否则就是拿空集冒充证据）', () => {
    if (baseline.corpora.user === 0) {
      for (const row of Object.values(baseline.values)) expect(row.userHitRate).toBe(0)
    }
  })

  // Calibration input for the fixed token line: how many skills the budget flags at the
  // default vs its 2x needs-restructure line. Not a magic-number assertion — the invariant is
  // containment (a lower line can only flag MORE), and the counts are printed for the record.
  it('soft line 7,273 tokens vs 2x: prints the flagged counts and holds the containment invariant', () => {
    const at = (line: number): number =>
      skills.filter(
        (s: { facts: { dims: { bodyTokens: number | null } } }) =>
          s.facts.dims.bodyTokens !== null && s.facts.dims.bodyTokens >= line,
      ).length
    const atLine = at(7_273)
    const atDouble = at(14_546)
    console.log('soft line: 7,273 tokens flags ' + String(atLine) + ' of ' + String(skills.length) + '; 14,546 flags ' + String(atDouble))
    expect(atLine).toBeGreaterThanOrEqual(atDouble)
  })
})
