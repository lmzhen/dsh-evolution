// @tier pre-tag
/**
 * G3a（PLAN-R6 §20.1）—— 今天的既有缺陷用 `it.fails` 钉住：一次 `restructure` 只给 SKILL.md 落版本，
 * 支撑文件被搬动却不产生版本条目，且版本之间没有任何组键（没有 `unitId`）⇒ 撤销无法把「一次结构变更」
 * 当成一个单元整体回滚。G3a 落地时把 `it.fails` 翻成 `it`（翻牌即「缺陷已修」的证据）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const stamp = String.fromCharCode(10)
const bodyWithExtra = ['---', 'name: r-skill', 'description: r-skill body', '---', '', '## Extra', 'extra content', ''].join(stamp)

it('R-G3a-1：restructure 写过的每个路径都有版本条目，且共享同一个 unitId', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-unit-undo-'))
  try {
    const lib = new SkillLibrary(root, nodeEvolutionIo())
    await lib.create('r-skill', bodyWithExtra)
    const result = await lib.restructure('r-skill', [{ heading: 'Extra', toFile: 'references/extra.md' }], 'foreground')
    expect(result.ok, result.message).toBe(true)
    const versions = await lib.listVersions('r-skill')
    const paths = versions.map(v => (v as { path?: string }).path ?? 'SKILL.md')
    expect(paths).toContain('references/extra.md')
    const units = new Set(versions.map(v => (v as { unitId?: string }).unitId).filter((u): u is string => typeof u === 'string' && u.length > 0))
    expect(units.size).toBe(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
