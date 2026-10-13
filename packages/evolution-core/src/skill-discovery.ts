/**
 * 技能发现形状 —— 家族里**唯一**的实现，门禁（`packages/scripts/verify-graph-edges.mjs`）
 * 与图谱/边解析必须都调用它（R21/R69：两处各自实现＝68/63 并存那类症状的根源）。
 *
 * 平台判定见 skill-filesystem/src/index.ts:677-684 (`isPotentialSkillPath`：`<root>/<name>.md`
 * 或 `<root>/<name>/SKILL.md`，即 depth<=2) 与 parseSkillFile:816-819 (`isSkillName`：kebab-case)；
 * 排除机制是三条而非一条前缀规则：`.archive/`、`.backups/` 靠**深度**（3 段 > 2），
 * `._x/` 靠**名字文法**，`.system` 才是真前缀排除(:666/:680)。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 技能名文法（与平台 `isSkillName` 等价：kebab-case，点前缀与下划线一律不是技能名）。 */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** 名字是否是技能名 —— `._x`、`Bad_Name`、`.archive` 都返回 false。 */
export function isSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name)
}

/** 相对技能根的路径是否落在平台会发现的位置（depth<=2 且最后一段是 SKILL.md 或 `<name>.md`）。 */
export function isPotentialSkillPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]+/).filter((p) => p.length > 0)
  if (parts.length < 1 || parts.length > 2) return false
  const last = parts[parts.length - 1]
  if (parts.length === 2) return last === 'SKILL.md' && isSkillName(parts[0])
  return last.endsWith('.md') && isSkillName(last.slice(0, -3))
}

export interface DiscoveredSkill {
  name: string
  path: string
}

/**
 * 扫描一个技能根，返回平台**真正会发现**的技能（非递归、depth<=2、含 `SKILL.md` 的目录、
 * 名字过 kebab-case、跳过点前缀目录）。忽略目录里的边不得计入，也不得算悬空。
 *
 * @param root - 技能根目录。
 * @returns 按名字排序的技能列表（根缺失时返回空数组）。
 */
export function discoverSkillFiles(root: string): DiscoveredSkill[] {
  if (!existsSync(root)) return []
  const found: DiscoveredSkill[] = []
  let entries: string[] = []
  try { entries = readdirSync(root) } catch { return [] }
  for (const entry of entries) {
    if (!isSkillName(entry)) continue
    const dir = join(root, entry)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    const md = join(dir, 'SKILL.md')
    if (!existsSync(md)) continue
    found.push({ name: entry, path: md })
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
