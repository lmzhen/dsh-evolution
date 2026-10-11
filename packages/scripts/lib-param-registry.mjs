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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Entry head (the 8 keys every row carries) plus the two legal endings: a plain
// close, or the optional UI tail (0.7.0) in its fixed order. A row that matches
// the head but neither ending is reported as malformed instead of silently
// vanishing from the parsed set — a silent drop is how a registry edit turns
// into a missing card without any guard firing.
const ENTRY_HEAD = /^\s*\{ id: '([^']+)', group: '([^']+)', tier: '([^']+)', authority: '([^']+)', owner: '([^']+)', applies: '([^']+)', docAnchor: '([^']+)', summary: '([^']*)'/
const ENTRY_TAIL = /, label: '([^']*)', hint: '([^']*)', control: '([^']*)', unit: '([^']*)', values: '([^']*)'(?:, valueLabels: '([^']*)')? \},$/
// A plain row ends with ' },' and NOTHING else: a half-written UI tail (say only a
// label) also ends that way, and accepting it would drop the tail silently while
// the "non-E3 rows must not carry UI metadata" rule never fired.
const ENTRY_PLAIN = /^ \},$/
// The exposure key (0.21.0 / G2), the FOURTH segment: exactly one of `card` (the settings card this
// row appears on) or `why` (the registered reason it has none). It sits after the UI tail when
// there is one, and directly after the head otherwise, so both endings have two shapes.
const EXPOSURE_CARD = /, card: '([^']+)' \},$/
const EXPOSURE_WHY = /, why: '([^']+)' \},$/
const ALIAS = /^\s*([A-Za-z][A-Za-z0-9]*): '([A-Za-z][A-Za-z0-9]*)',$/

/** The UI tail, in its fixed order (see the contract in params.ts). */
const UI_KEYS = ['label', 'hint', 'control', 'unit', 'values']
/** Trailing UI keys a select row MAY add; never required, never allowed elsewhere. */
const OPTIONAL_UI_KEYS = ['valueLabels']

// GROUPS is the doc-section axis (the unit a developer changes together); WHY is the reason axis for
// a row with no card. 'internal' appears on both axes and means different things there — see the
// ParamGroup contract in params.ts.
export const GROUPS = ['library', 'write-caps', 'review', 'memory', 'curator', 'deployment', 'internal']
export const TIERS = ['E0', 'E1', 'E2', 'E3', 'E4']
export const AUTHORITIES = ['code', 'cordis', 'install']
export const APPLIES = ['live', 'restart', 'none']
export const CONTROLS = ['number', 'switch', 'select', 'text']
/** Why a parameter has no settings card. `internal` covers timeouts, retries, cooldowns, weights,
 * caps and windows; `deployment` the mount switches and library-scope policy; `security` the safety
 * surfaces (never user-writable); `identity` providers/models; `path` per-row directories;
 * `install` what the installer freezes. */
export const WHY = ['deployment', 'security', 'identity', 'path', 'install', 'internal']

/** Chinese text is required for the card's label/hint (they are user-facing copy). */
const CJK = /[\u4e00-\u9fa5]/

/** Absolute path of the registry source for one evolution root. */
export function registryPath(root) {
  return join(root, 'evolution-core', 'src', 'params.ts')
}

const NAMESPACE_ENTRY = /^\s*'([^']+)': '([^']+)',$/
const GROUP_LABEL_ENTRY = /^\s*'?([a-z-]+)'?: '([^']+)',$/

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
/**
 * Parse the group → Chinese display-name block (same one-entry-per-line contract).
 * @param {string} text - the registry source.
 * @returns {Record<string, string>} group id → display name.
 */
function readGroupLabels(text) {
  const start = text.indexOf('export const PARAM_GROUP_LABELS')
  const body = start < 0 ? '' : text.slice(start, text.indexOf('})', start))
  const labels = {}
  for (const line of body.split(/\r?\n/)) {
    const match = GROUP_LABEL_ENTRY.exec(line)
    if (match) labels[match[1]] = match[2]
  }
  return labels
}

/**
 * Parse the registry text.
 * @param {string} root - evolution root (the directory holding the packages).
 * @returns {{ entries: object[], aliases: Record<string, string>, groupLabels: Record<string, string>, text: string, path: string }}
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
      let rest = line.slice(head[0].length)
      // Peel the exposure keys first: they terminate the line, so what remains is the ending the
      // head/tail rules already know. Strip them tail-first in a loop rather than taking the first
      // match: a row carrying BOTH keys then reaches the tier check as a contract violation with a
      // precise message, instead of falling out as an unparseable ending with no named cause.
      const exposure = {}
      for (;;) {
        const card = EXPOSURE_CARD.exec(rest)
        const why = EXPOSURE_WHY.exec(rest)
        const hit = card ?? why
        if (hit === null) break
        if (card !== null) exposure.card = card[1]
        else exposure.why = why[1]
        rest = rest.slice(0, hit.index) + ' },'
      }
      const tail = ENTRY_TAIL.exec(rest)
      if (tail) {
        const entry = {
          id: head[1], group: head[2], tier: head[3], authority: head[4],
          owner: head[5], applies: head[6], docAnchor: head[7], summary: head[8],
          label: tail[1], hint: tail[2], control: tail[3], unit: tail[4], values: tail[5],
          ...exposure,
        }
        // Absent stays absent: the validator distinguishes 'row did not opt in' from
        // 'row opted in with an empty list'.
        if (tail[6] !== undefined) entry.valueLabels = tail[6]
        entries.push(entry)
      } else if (ENTRY_PLAIN.test(rest)) {
        entries.push({
          id: head[1], group: head[2], tier: head[3], authority: head[4],
          owner: head[5], applies: head[6], docAnchor: head[7], summary: head[8],
          ...exposure,
        })
      } else {
        malformed.push(head[1] + ' (bad ending — expected the UI tail `, label: …, hint: …, control: …, unit: …, values: …[, valueLabels: …]` where the tier requires it, then exactly one of `, card: \'<row-id>\'` / `, why: \'<reason>\'`, then ` },`)')
      }
    }
  }
  return { entries, malformed, aliases, groupLabels: readGroupLabels(text), text, path }
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
    // The exposure key: exactly one per row, and the TIER decides which. `card` answers "which card
    // renders this row" (E3 only: the platform projects only a row's own volatile fields into its
    // card); `why` answers "why no card" (every other tier). Together they make "an E3 row that no
    // card renders" unspellable — the state that shipped as evolution-approval.pendingTtlMs.
    if (entry.tier === 'E3') {
      if (entry.card === undefined) violations.push(where + ': E3 row must carry `card` (the card that renders it)')
      else if (entry.why !== undefined) violations.push(where + ': card and why are mutually exclusive')
      else if (entry.card !== entry.owner) violations.push(where + ': card "' + entry.card + '" is not this row\'s own id (' + entry.owner + ')')
    } else if (entry.why === undefined) {
      violations.push(where + ': non-E3 row must carry `why` — name the reason it has no settings card (' + WHY.join('/') + ')')
    } else if (entry.card !== undefined) {
      violations.push(where + ': ' + entry.tier + ' row must not carry `card` — a card may only render its own row\'s E3 fields')
    }
    if (entry.why !== undefined && !WHY.includes(entry.why)) {
      violations.push(where + ': unknown why "' + entry.why + '" — one of ' + WHY.join('/'))
    }
    const carried = [...UI_KEYS, ...OPTIONAL_UI_KEYS].filter(key => entry[key] !== undefined)
    if (entry.tier === 'E3') {
      const missing = UI_KEYS.filter(key => entry[key] === undefined)
      if (missing.length > 0) {
        violations.push(where + ': E3 row must carry the full UI tail ' + UI_KEYS.join('/') + ' (missing ' + missing.join('/') + ')')
      } else {
        if (entry.label.length === 0) violations.push(where + ': label is empty')
        if (entry.hint.length === 0) violations.push(where + ': hint is empty')
        if (!CONTROLS.includes(entry.control)) violations.push(where + ': unknown control ' + entry.control)
        if (!CJK.test(entry.label)) violations.push(where + ': label must be Chinese text')
        if (!CJK.test(entry.hint)) violations.push(where + ': hint must be Chinese text')
        if (entry.control === 'select' && entry.values.length === 0) violations.push(where + ": control 'select' requires a non-empty values list")
        if (entry.control !== 'select' && entry.values.length > 0) violations.push(where + ": values is only meaningful for control 'select'")
        // valueLabels (0.9.0): display names for the enum, one per value. The stored
        // value stays raw, so a mismatch here would mislabel an option in the card.
        if (entry.valueLabels !== undefined) {
          const names = entry.valueLabels.split('|')
          const values = entry.values.split('|')
          if (entry.control !== 'select') violations.push(where + ': valueLabels is only meaningful for control ' + String(entry.control))
          else if (names.length !== values.length) violations.push(where + ': valueLabels has ' + names.length + ' name(s) for ' + values.length + ' value(s)')
          else for (const name of names) if (!CJK.test(name)) violations.push(where + ': valueLabels must be Chinese text (' + name + ')')
        }
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
    '| E2 | 部署方 | `cordis.yml` 行／补丁层 | 补丁层在长驻面热重载 |',
    '| E3 | 本机用户 | `settings.yaml`／GUI 卡／`/evolution policy set` | 见 applies 列 |',
    '| E4 | 安装者 | 安装器开关／`row-overrides.json` | 装完固化 |',
    '',
    '## 设置面（第八列怎么读）',
    '',
    'E3 行的第八列写 `卡：<row-id>`——**那张卡渲染的就是这一行的字段**（平台按 Loader 行 id 取卡，一张卡只渲染自己那行的 volatile 字段）。其余档写 `无（<why>）`，`why` 取值（**用列表不用表格**：门禁把 `| `id` |` 形状的行当作参数行，表格会把它读成 6 个不存在的参数）：',
    '',
    '- `deployment` —— 挂载开关与库级范围策略（部署方的决定）',
    '- `security` —— 安全面（工具授权、威胁豁免、审批闸；永不给用户）',
    '- `identity` —— provider／模型／注册名',
    '- `path` —— 每行各自的目录（技能根、事件目录、状态目录）',
    '- `install` —— 安装期固化',
    '- `internal` —— 超时／重试／冷却／权重／上限／窗口／阈值',
    '',
  ]
  for (const group of GROUPS) {
    const rows = registry.entries.filter(entry => entry.group === group)
    if (rows.length === 0) continue
    const label = registry.groupLabels?.[group]
    lines.push('## ' + group + (label === undefined ? '' : '（' + label + '）'), '', '| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 设置面 | 说明 |', '|---|---|---|---|---|---|---|---|')
    for (const entry of rows) {
      const legacy = (aliasOf[entry.id] ?? []).join(', ') || '—'
      // The exposure column answers the reader's actual question about a knob they cannot find on
      // any card: it names the card, or the registered reason there is none.
      const exposure = entry.card === undefined ? '无（' + entry.why + '）' : '卡：' + entry.card
      lines.push('| `' + entry.id + '` | ' + entry.tier + ' | ' + entry.applies + ' | ' + entry.authority + ' | ' + entry.owner + ' | ' + legacy + ' | ' + exposure + ' | ' + entry.summary + ' |')
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
