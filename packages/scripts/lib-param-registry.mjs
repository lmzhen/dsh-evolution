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

// Entry head (the 8 keys every row carries) plus the two legal endings: a plain
// close, or the optional UI tail (0.7.0) in its fixed order. A row that matches
// the head but neither ending is reported as malformed instead of silently
// vanishing from the parsed set — a silent drop is how a registry edit turns
// into a missing card without any guard firing.
const ENTRY_HEAD = /^\s*\{ id: '([^']+)', group: '([^']+)', tier: '([^']+)', authority: '([^']+)', owner: '([^']+)', applies: '([^']+)', docAnchor: '([^']+)', summary: '([^']*)'/
const ENTRY_TAIL = /, label: '([^']*)', hint: '([^']*)', control: '([^']*)', unit: '([^']*)', values: '([^']*)' \},$/
const ENTRY_PLAIN = / \},$/
const ALIAS = /^\s*([A-Za-z][A-Za-z0-9]*): '([A-Za-z][A-Za-z0-9]*)',$/

/** The optional UI tail, in its fixed order (see the contract in params.ts). */
const UI_KEYS = ['label', 'hint', 'control', 'unit', 'values']

export const GROUPS = ['library', 'write-caps', 'review', 'memory', 'curator', 'deployment', 'internal']
export const TIERS = ['E0', 'E1', 'E2', 'E3', 'E4']
export const AUTHORITIES = ['code', 'cordis', 'install']
export const APPLIES = ['live', 'restart', 'none']
export const CONTROLS = ['number', 'switch', 'select', 'text']

/** Chinese text is required for the card's label/hint (they are user-facing copy). */
const CJK = /[\u4e00-\u9fa5]/

/** Absolute path of the registry source for one evolution root. */
export function registryPath(root) {
  return join(root, 'evolution-core', 'src', 'params.ts')
}

const NAMESPACE_ENTRY = /^\s*'([^']+)': '([^']+)',$/

/**
 * Parse the owner-package → namespace map from the registry text (the same
 * machine-read contract the entries use: one entry per line). Keep this in step
 * with PARAM_NAMESPACES in params.ts — param-registry.spec.ts asserts the two.
 * @param {string} root - evolution root (the directory holding the packages).
 * @returns {Record<string, string>} owner package directory name → namespace.
 */
export function readNamespaces(root) {
  const text = readFileSync(registryPath(root), 'utf8')
  const start = text.indexOf('export const PARAM_NAMESPACES')
  const body = start < 0 ? '' : text.slice(start, text.indexOf('})', start))
  const namespaces = {}
  for (const line of body.split(/\r?\n/)) {
    const match = NAMESPACE_ENTRY.exec(line)
    if (match) namespaces[match[1]] = match[2]
  }
  return namespaces
}

/** Absolute path of the generated parameter document for one evolution root.
 *
 * It sits at the family root BESIDE INSTALL.md, not under `packages/docs/`: that
 * tree is gitignored and CONTRIBUTING calls it a source of material, never a
 * home, so a gate cannot require a tracked document to match it. */
export function docsPath(root) {
  return join(root, 'PARAMETERS.md')
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
  const malformed = []
  const aliases = {}
  let inAliases = false
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('PARAM_ALIASES')) inAliases = line.includes('{')
    if (inAliases) {
      const alias = ALIAS.exec(line)
      if (alias) aliases[alias[1]] = alias[2]
      if (line.trim().startsWith('})')) inAliases = false
    }
    const head = ENTRY_HEAD.exec(line)
    if (head) {
      const rest = line.slice(head[0].length)
      const tail = ENTRY_TAIL.exec(rest)
      if (tail) {
        entries.push({
          id: head[1], group: head[2], tier: head[3], authority: head[4],
          owner: head[5], applies: head[6], docAnchor: head[7], summary: head[8],
          label: tail[1], hint: tail[2], control: tail[3], unit: tail[4], values: tail[5],
        })
      } else if (ENTRY_PLAIN.test(rest)) {
        entries.push({
          id: head[1], group: head[2], tier: head[3], authority: head[4],
          owner: head[5], applies: head[6], docAnchor: head[7], summary: head[8],
        })
      } else {
        malformed.push(head[1] + ' (bad UI tail — expected `, label: …, hint: …, control: …, unit: …, values: … },`)')
      }
    }
  }
  return { entries, malformed, aliases, text, path }
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
  for (const bad of registry.malformed ?? []) violations.push('entry ' + bad)
  for (const entry of registry.entries) {
    const where = 'entry ' + entry.id
    if (seen.has(entry.id)) violations.push(where + ': duplicate id')
    seen.add(entry.id)
    if (!GROUPS.includes(entry.group)) violations.push(where + ': unknown group ' + entry.group)
    if (!TIERS.includes(entry.tier)) violations.push(where + ': unknown tier ' + entry.tier)
    if (!AUTHORITIES.includes(entry.authority)) violations.push(where + ': unknown authority ' + entry.authority)
    if (!APPLIES.includes(entry.applies)) violations.push(where + ': unknown applies ' + entry.applies)
    if (registry.aliases[entry.id] !== undefined) violations.push(where + ': registers a deprecated alias instead of the canonical id')
    // The owner is the package DIRECTORY name (the family mixes evolution-* with bare
    // names such as memory-files/tool-memory), so existence is the real check.
    if (entry.owner.length === 0) violations.push(where + ': owner is empty')
    else if (!existsSync(join(root, entry.owner))) violations.push(where + ': owner package ' + entry.owner + ' does not exist')
    if (!entry.docAnchor.startsWith('PARAMETERS.md#')) violations.push(where + ': docAnchor must start with PARAMETERS.md# (the tracked parameter table)')
    if (entry.summary.length < 10) violations.push(where + ': summary is too short to be useful')
    const writable = entry.tier === 'E3' || entry.tier === 'E4'
    if (writable && entry.applies === 'none') violations.push(where + ': tier ' + entry.tier + ' must declare a settings timing')
    if (!writable && entry.applies !== 'none') violations.push(where + ': tier ' + entry.tier + ' is read-only and must use applies: none')
    // UI metadata (0.7.0): the settings cards render E3 rows only, so the tail is
    // required there and forbidden everywhere else — a non-E3 row carrying a label
    // would describe a control that no surface renders.
    const carried = UI_KEYS.filter(key => entry[key] !== undefined)
    if (entry.tier === 'E3') {
      if (carried.length !== UI_KEYS.length) {
        violations.push(where + ': E3 row must carry the full UI tail ' + UI_KEYS.join('/') + ' (has ' + (carried.join('/') || 'none') + ')')
      } else {
        if (entry.label.length === 0) violations.push(where + ': label is empty')
        if (entry.hint.length === 0) violations.push(where + ': hint is empty')
        if (!CONTROLS.includes(entry.control)) violations.push(where + ': unknown control ' + entry.control)
        if (!CJK.test(entry.label)) violations.push(where + ': label must be Chinese text')
        if (!CJK.test(entry.hint)) violations.push(where + ': hint must be Chinese text')
        if (entry.control === 'select' && entry.values.length === 0) violations.push(where + ": control 'select' requires a non-empty values list")
        if (entry.control !== 'select' && entry.values.length > 0) violations.push(where + ": values is only meaningful for control 'select'")
      }
    } else if (carried.length > 0) {
      violations.push(where + ': tier ' + entry.tier + ' must not carry UI metadata (only E3 rows have a card surface)')
    }
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
    '> 由 `packages/scripts/gen-param-docs.mjs` 从 `evolution-core/src/params.ts` 的注册表生成，',
    '> 门禁 `verify-param-registry` 逐字节比对两者（本文件受版本控制，是可引用的正文面）。',
    '> 改参数请改注册表，然后重跑生成器（`node packages/scripts/gen-param-docs.mjs packages`）。',
    '> 会话内读同一份数据不需要文件：`/evolution params` 打印同样的行。',
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
