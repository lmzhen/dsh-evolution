#!/usr/bin/env node
/**
 * Shared reader for the parameter registry (G1/S1.2-S1.3).
 *
 * The registry lives in TypeScript (evolution-core/src/params.ts) because the
 * runtime reads it (params output, doctor, cards). These .mjs tools read the
 * SAME text through the machine-read contract documented there: one entry per
 * line with a fixed key order. param-registry.spec.ts asserts the parsed text
 * and the runtime array agree, so the text and the module cannot drift.
 *
 * Correctness of this .mjs is proven by evolution-host/tests/guard-scripts.spec.ts
 * (scripts sit outside oxlint, like every other family guard).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ENTRY = /^\s*\{ id: '([^']+)', group: '([^']+)', tier: '([^']+)', authority: '([^']+)', owner: '([^']+)', applies: '([^']+)', docAnchor: '([^']+)', summary: '([^']*)' \},$/
const ALIAS = /^\s*([A-Za-z][A-Za-z0-9]*): '([A-Za-z][A-Za-z0-9]*)',$/

export const GROUPS = ['library', 'write-caps', 'review', 'memory', 'curator', 'deployment', 'internal']
export const TIERS = ['E0', 'E1', 'E2', 'E3', 'E4']
export const AUTHORITIES = ['code', 'cordis', 'install']
export const APPLIES = ['live', 'restart', 'none']

/** Absolute path of the registry source for one evolution root. */
export function registryPath(root) {
  return join(root, 'evolution-core', 'src', 'params.ts')
}

/** Absolute path of the generated parameter document for one evolution root. */
export function docsPath(root) {
  return join(root, 'docs', 'parameters.md')
}

/**
 * Parse the registry text.
 * @param {string} root - evolution root (the directory holding the packages).
 * @returns {{ entries: object[], aliases: Record<string, string>, text: string, path: string }}
 */
export function readRegistry(root) {
  const path = registryPath(root)
  const text = readFileSync(path, 'utf8')
  const entries = []
  const aliases = {}
  let inAliases = false
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('PARAM_ALIASES')) inAliases = line.includes('{')
    if (inAliases) {
      const alias = ALIAS.exec(line)
      if (alias) aliases[alias[1]] = alias[2]
      if (line.trim().startsWith('})')) inAliases = false
    }
    const entry = ENTRY.exec(line)
    if (entry) {
      entries.push({
        id: entry[1], group: entry[2], tier: entry[3], authority: entry[4],
        owner: entry[5], applies: entry[6], docAnchor: entry[7], summary: entry[8],
      })
    }
  }
  return { entries, aliases, text, path }
}

/**
 * Invariants the registry must satisfy (design 8.1).
 * @param {{ entries: object[], aliases: Record<string, string> }} registry - parsed registry.
 * @param {string} root - evolution root, used for the owner-package existence check.
 * @returns {{ violations: string[], notes: string[] }}
 */
export function registryViolations(registry, root) {
  const violations = []
  const notes = []
  const seen = new Set()
  for (const entry of registry.entries) {
    const where = 'entry ' + entry.id
    if (seen.has(entry.id)) violations.push(where + ': duplicate id')
    seen.add(entry.id)
    if (!GROUPS.includes(entry.group)) violations.push(where + ': unknown group ' + entry.group)
    if (!TIERS.includes(entry.tier)) violations.push(where + ': unknown tier ' + entry.tier)
    if (!AUTHORITIES.includes(entry.authority)) violations.push(where + ': unknown authority ' + entry.authority)
    if (!APPLIES.includes(entry.applies)) violations.push(where + ': unknown applies ' + entry.applies)
    if (registry.aliases[entry.id] !== undefined) violations.push(where + ': registers a deprecated alias instead of the canonical id')
    if (!/^evolution-[a-z0-9-]+$/.test(entry.owner)) violations.push(where + ': owner must be an evolution-<pkg> name')
    else if (!existsSync(join(root, entry.owner))) violations.push(where + ': owner package ' + entry.owner + ' does not exist')
    if (!entry.docAnchor.startsWith('docs/')) violations.push(where + ': docAnchor must start with docs/')
    if (entry.summary.length < 10) violations.push(where + ': summary is too short to be useful')
    const writable = entry.tier === 'E3' || entry.tier === 'E4'
    if (writable && entry.applies === 'none') violations.push(where + ': tier ' + entry.tier + ' must declare a settings timing')
    if (!writable && entry.applies !== 'none') violations.push(where + ': tier ' + entry.tier + ' is read-only and must use applies: none')
  }
  for (const [alias, canonical] of Object.entries(registry.aliases)) {
    if (!seen.has(canonical)) notes.push('canonical id ' + canonical + ' (alias ' + alias + ') is not registered yet')
  }
  if (registry.entries.length === 0) violations.push('registry parsed zero entries — the machine-read contract changed shape')
  return { violations, notes }
}

/**
 * Render the parameter document (deterministic: same registry, same bytes).
 * @param {{ entries: object[], aliases: Record<string, string> }} registry - parsed registry.
 * @param {{ violations: string[], notes: string[] }} check - result of registryViolations.
 * @returns {string} markdown document, trailing newline included.
 */
export function renderParamDocs(registry, check) {
  const aliasOf = {}
  for (const [alias, canonical] of Object.entries(registry.aliases)) {
    ;(aliasOf[canonical] ??= []).push(alias)
  }
  const lines = [
    '# 参数表（生成物，勿手改）',
    '',
    '> 由 `packages/scripts/gen-param-docs.mjs` 从 `evolution-core/src/params.ts` 的注册表生成；',
    '> 改参数请改注册表，然后重跑生成器（`node packages/scripts/gen-param-docs.mjs packages`）。',
    '',
    '## 档位含义（改哪个面）',
    '',
    '| 档 | 谁能写 | 写面 | 生效 |',
    '|---|---|---|---|',
    '| E0 | 无人 | 代码常量 | 随版本 |',
    '| E1 | 无人 | 只读可见（dump／`/evolution params`） | — |',
    '| E2 | 部署方 | `cordis.yml` 行／补丁层 | 本部署 patchReload=live |',
    '| E3 | 本机用户 | `settings.yaml`／GUI 卡／`/evolution policy set` | 见 applies 列 |',
    '| E4 | 安装者 | 安装器开关／`row-overrides.json` | 装完固化 |',
    '',
  ]
  for (const group of GROUPS) {
    const rows = registry.entries.filter(entry => entry.group === group)
    if (rows.length === 0) continue
    lines.push('## ' + group, '', '| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 说明 |', '|---|---|---|---|---|---|---|')
    for (const entry of rows) {
      const legacy = (aliasOf[entry.id] ?? []).join(', ') || '—'
      lines.push('| `' + entry.id + '` | ' + entry.tier + ' | ' + entry.applies + ' | ' + entry.authority + ' | ' + entry.owner + ' | ' + legacy + ' | ' + entry.summary + ' |')
    }
    lines.push('')
  }
  if (check.notes.length > 0) {
    lines.push('## 尚未登记的 canonical id（S2.1 收口）', '')
    for (const note of check.notes) lines.push('- ' + note)
    lines.push('')
  }
  return lines.join('\n')
}
