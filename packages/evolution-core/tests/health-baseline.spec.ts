/*
 * G1 标定：把两侧语料量成可审计的产物，并检查它的结构（契约 §4）。
 *
 * 这个 spec 只做三件事：遍历语料（缺语料就明确跳过，不假绿）、用引擎算基线、校验产物的形状与不变量。
 * 准入判定（平台 0 命中 / 用户 5%–25%）由门禁脚本读同一份产物执行 —— 判定逻辑在引擎侧，门禁只读。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildHealthBaseline, type Corpus, type CorpusSkill } from '../src/health-baseline.ts'
import { RULES } from '../src/skill-lint.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

interface CorpusRoot { corpus: Corpus; root: string }

/** 语料根由环境给出；没给就用本机默认位置，都不存在时该侧语料为空（明确记录，不装作测过）。 */
function corpusRoots(): CorpusRoot[] {
  const home = homedir().replace(/\\/g, '/')
  return [
    { corpus: 'user', root: process.env.DSH_USER_SKILLS ?? home + '/.dsh/skills' },
    { corpus: 'platform', root: process.env.DSH_PLATFORM_SKILLS ?? home + '/.dsh/platform-skills' },
  ]
}

function readSkillFacts(corpus: Corpus, root: string): CorpusSkill[] {
  if (!existsSync(root)) return []
  const out: CorpusSkill[] = []
  for (const name of readdirSync(root)) {
    const skillFile = join(root, name, 'SKILL.md')
    if (!existsSync(skillFile) || !statSync(skillFile).isFile()) continue
    const bodyText = readFileSync(skillFile, 'utf8')
    const refs = join(root, name, 'references')
    const supportFiles = existsSync(refs) ? readdirSync(refs).filter(f => f.endsWith('.md') && !f.startsWith('_')).length : 0
    out.push({
      name,
      corpus,
      facts: {
        skillName: name,
        dims: {
          bodyChars: bodyText.length,
          bodyTokens: Math.round(bodyText.length / 4),
          stampDensityPerKb: null,
          supportGroups: supportFiles > 0 ? 1 : 0,
          supportFiles,
          churnPatches: null,
          churnReads: null,
        },
        softLineChars: 24_000,
        overSoftLine: bodyText.length >= 24_000,
        overTwiceSoftLine: bodyText.length >= 48_000,
        stampLimitPerKb: 1,
        churnMinPatches: 20,
        readable: true,
      },
    })
  }
  return out
}

describe('G1 标定：health-baseline 产物', () => {
  const skills = corpusRoots().flatMap(r => readSkillFacts(r.corpus, r.root))
  const baseline = buildHealthBaseline(skills)

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

  it('需要时把产物写到仓内（WRITE_HEALTH_BASELINE=1），否则只写临时目录', () => {
    const text = JSON.stringify(baseline, null, 2) + '\n'
    const target = process.env.WRITE_HEALTH_BASELINE === '1'
      ? join(HERE, '..', '..', '..', 'scripts', 'reports', 'health-baseline.json')
      : join(process.env.TEMP ?? '/tmp', 'health-baseline.json')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
    expect(existsSync(target)).toBe(true)
  })

  // Calibration input for the soft-line decision: how many skills the line flags at the CURRENT
  // default vs the candidate 24_000. Not a magic-number assertion — the invariant is containment
  // (a lower line can only flag MORE), and the counts are printed for the record.
  it('soft line 40k vs 24k: prints the flagged counts and holds the containment invariant', () => {
    const at = (line: number): number =>
      skills.filter(s => s.facts.dims.bodyChars !== null && s.facts.dims.bodyChars >= line).length
    const at40 = at(40_000)
    const at24 = at(24_000)
    console.log('soft line: 40_000 flags ' + String(at40) + ' of ' + String(skills.length) + '; 24_000 flags ' + String(at24))
    expect(at24).toBeGreaterThanOrEqual(at40)
  })
})
