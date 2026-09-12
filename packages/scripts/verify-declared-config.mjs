#!/usr/bin/env node
/**
 * G3.1 declared-config reach guard: every config key the family DECLARES must
 * have a plane that actually reads it.
 *
 * Root cause this closes (v27 T-1): the bundles declare
 * `tool-skill.catalogDescriptionMaxLength: 60` as a profile-root override, but
 * the platform's `web-app` bundle disables the profile-root `tool-skill` row
 * (`packages/bundle/web-app/cordis.patch.yml:333`) because presets own the
 * per-agent skill rows. A patch layer only overrides keys of a row that exists
 * AND is enabled in the plane below it, so "my patch file has the row" was
 * never evidence that the key takes effect — in the default web install the
 * override reached nothing and the session-visible catalog kept the platform
 * default (500).
 *
 * Three reach classes, all mechanical:
 *   - row-mounted:  the declaration sits on a row THIS bundle mounts
 *                   (`- id: X` together with `name:` in the same item), so any
 *                   profile that mounts the bundle gets the config.
 *   - profile-root: the declaration overrides an upstream row that no plane of
 *                   the target profile disables.
 *   - composer:     the row is disabled at profile root, so the declaration is
 *                   reachable only where the family composes the preset. Each
 *                   such entry names the code that injects the key, and this
 *                   guard fails unless that code still contains it — a claimed
 *                   reach that rotted is a violation, not a note.
 * Anything else is a violation: a declared key with no plane that reads it.
 *
 * UPSTREAM_PLANES holds the platform facts (which rows a plane disables) as a
 * SNAPSHOT of `packages/bundle/<plane>/cordis.patch.yml`: the mirror does not
 * carry `packages/bundle/**`, so this table is the repository's record of them
 * and the thing to re-check whenever an upstream bundle changes. The `source`
 * field names the platform file WITHOUT line anchors — a hand-copied line
 * number rots silently, which is exactly what v33 P2-F1 found. Pass
 * `--upstream <platform-tree>` to RECOMPUTE every plane's classification from
 * the platform's own patch files and fail on drift
 * (`upstream-planes-drift`); without it the table is used as-is.
 *
 * The same `--upstream` run also recomputes the platform `Config` key set of
 * every overridden row and checks that the bundle patches NAME each key in
 * their whole-config-replacement note (v33 G2.3): a platform key added
 * upstream must be acknowledged where the wholesale replacement happens.
 *
 * 0.3.68 (v27 G3.1): WARN mode by default — batch 3 wires each new gate in warn
 * mode for one release before flipping it, matching verify-arch-guards. Pass
 * `--strict` (or set DSH_EVOLUTION_DECLARED_CONFIG_STRICT=1) to fail loud.
 *
 * Usage (works from BOTH layouts — dev `packages/evolution/scripts/…`, flat
 * mirror `packages/scripts/…`; the root argument is the evolution packages tree
 * in either layout, and the composer anchors resolve relative to it):
 *   node <scripts-dir>/verify-declared-config.mjs <evolution-root> [--strict]
 *     [--upstream <platform-tree>]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const root = resolve(argv[0] ?? 'packages/evolution')
const strict = argv.includes('--strict') || process.env.DSH_EVOLUTION_DECLARED_CONFIG_STRICT === '1'
const upstreamArg = argv.indexOf('--upstream')
const upstream = upstreamArg >= 0 ? resolve(argv[upstreamArg + 1] ?? '') : null
if (upstreamArg >= 0 && (!argv[upstreamArg + 1] || (argv[upstreamArg + 1] ?? '').startsWith('--'))) {
  console.error('verify-declared-config: --upstream needs a platform tree path (the checkout carrying packages/bundle/*/cordis.patch.yml)')
  process.exit(2)
}

/** The three bundle patch layers that declare deployment config. */
const BUNDLE_PATCHES = ['evolution-all', 'evolution-host', 'evolution-preset']

/**
 * Target profiles, as their ordered plane list. `web` is what `dsh web` boots
 * (the base host plane plus the web-app bundle); `headless` boots the base
 * plane alone.
 */
const PROFILE_PLANES = {
  web: ['base', 'web-app'],
  headless: ['base'],
}

/**
 * Platform plane facts, SNAPSHOTTED from the target platform line
 * (0.1.5-rc.2). Recomputed and compared by `--upstream`; with no platform tree
 * the table is the authority, so it must stay complete:
 *   - `disabled` is EXACT — every row the plane turns off, because that set
 *     decides whether a declared override reaches anything at profile root. A
 *     missing entry would silently upgrade an unreachable override to
 *     `profile-root`.
 *   - `mounted` is a CONFIRMATION LIST — the rows this table has confirmed the
 *     plane mounts enabled (the rows the family overrides). Each entry must
 *     still exist and be enabled upstream; completeness is not required, since
 *     no declaration in this repository targets any other row.
 * `source` names the platform file with no line anchor: a copied line number
 * rots without a signal, which is what `--upstream` exists to prevent.
 */
const UPSTREAM_PLANES = {
  base: {
    disabled: ['hmr', 'skill-badge'],
    mounted: ['session-query-sqlite', 'tool-skill'],
    source: 'packages/bundle/base/cordis.patch.yml (session-query-sqlite and tool-skill mounted; skill-badge and hmr disabled:true)',
  },
  'web-app': {
    disabled: [
      'ui-schedule',
      'tool-bash',
      'tool-pwsh',
      'tool-jobs',
      'tool-fs',
      'tool-fs-search',
      'skill-filesystem',
      'tool-skill',
      'command-goal',
      'tool-goal',
      'plan-mode',
      'compaction-basic',
      'command-compact',
      'tool-result-pruner',
      'tool-subagent-control',
      'tool-subagent-list-agents',
      'tool-subagent',
      'tool-subagent-fork',
      'workflow-worker-thread',
      'tool-workflow',
      'tool-ralph',
      'agent-instructions',
      'tool-todo',
      'tool-web',
    ],
    mounted: [],
    source: 'packages/bundle/web-app/cordis.patch.yml (skill-filesystem and tool-skill disabled:true — the platform moves the per-agent skill rows into presets)',
  },
}

/**
 * Platform `Config` keys of every row this repository OVERRIDES, snapshotted
 * from the target platform line. Two consumers:
 *   - `--upstream` recomputes them from the platform sources listed in
 *     PLATFORM_ROW_CONFIG_SOURCES and fails on drift;
 *   - every run checks that each key is NAMED in the bundle patches'
 *     whole-config-replacement note, so the acknowledgment cannot go stale
 *     when the platform adds a key (v33 G2.3).
 * Overrides replace a row's `config` wholesale, so an unnamed key silently
 * falls back to its schema default.
 */
const PLATFORM_ROW_CONFIG_KEYS = {
  'session-query-sqlite': [
    'path',
    'openAt',
    'journalMode',
    'defaultLimit',
    'maxLimit',
    'snippetChars',
    'readWindowMax',
    'persistedReadConcurrency',
    'preparedSessionCacheSize',
  ],
  'tool-skill': ['catalogDescriptionMaxLength'],
}

/** Platform sources carrying each row's `Config` interface: the row's own
 * module plus any base `Config` it extends (`session-query-sqlite` extends the
 * backend-independent session-query Config). */
const PLATFORM_ROW_CONFIG_SOURCES = {
  'session-query-sqlite': [
    'packages/session-query/session-query-sqlite/src/index.ts',
    'packages/session-query/session-query/src/config.ts',
  ],
  'tool-skill': ['packages/skill/tool-skill/src/index.ts'],
}

/**
 * Declarations whose only reach is the preset composer, because the profile
 * root of at least one target profile disables their row. Every `anchors` entry
 * must still contain its needle, so the reach cannot be claimed without the
 * code that provides it.
 */
const COMPOSER_REACHED = [
  {
    row: 'tool-skill',
    key: 'catalogDescriptionMaxLength',
    reach: 'the preset composer injects this key onto the `- id: tool-skill` row of the preset it composes — that row is the session-visible instance under the web plane',
    anchors: [
      { file: 'evolution-core/src/preset-composition.ts', needle: 'catalogDescriptionMaxLength: 60' },
      { file: 'scripts/install-layered.mjs', needle: 'catalogDescriptionMaxLength: 60' },
    ],
    limits: 'a session running a preset the evolution composer did NOT generate (a platform preset, or one anchored before the composer ran) keeps the platform default until the preset is recomposed or the upstream default changes (F12)',
  },
]

/**
 * Parse a patch layer into its items: `{ id, line, name, disabled, configKeys }`.
 * Line scan (no YAML library, same style as the other guards): an item starts at
 * `- id: X` and owns every following line indented deeper than it.
 *
 * @param text - the patch file's content.
 * @param file - path used in diagnostics.
 * @returns the parsed items in file order.
 */
function parsePatchItems(text, file) {
  const items = []
  let current = null
  for (const [index, line] of text.split('\n').entries()) {
    const idMatch = /^(\s*)- id:\s*(\S+)\s*$/.exec(line)
    if (idMatch) {
      current = { id: idMatch[2], line: index + 1, indent: idMatch[1].length, name: null, disabled: null, configIndent: -1, configKeys: [] }
      items.push(current)
      continue
    }
    if (current === null) continue
    if (line.trim() === '') { current = null; continue }
    const indent = line.length - line.trimStart().length
    if (indent <= current.indent) { current = null; continue }
    const nameMatch = /^\s*name:\s*(\S+)/.exec(line)
    if (nameMatch) current.name = nameMatch[1]
    const disabledMatch = /^\s*disabled:\s*(\S+)/.exec(line)
    if (disabledMatch) current.disabled = disabledMatch[1]
    const configMatch = /^(\s*)config:\s*$/.exec(line)
    if (configMatch) { current.configIndent = configMatch[1].length; continue }
    if (current.configIndent >= 0) {
      const keyMatch = /^(\s+)([A-Za-z0-9_]+):/.exec(line)
      if (keyMatch && keyMatch[1].length === current.configIndent + 2) current.configKeys.push(keyMatch[2])
    }
  }
  return items.map(item => ({ ...item, file }))
}

const composerEntry = (row, key) => COMPOSER_REACHED.find(entry => entry.row === row && entry.key === key)

/**
 * Recompute one plane's row classification from the platform's own patch file.
 *
 * @param plane - the bundle plane id (`base` / `web-app`).
 * @returns `{ path, disabled, mounted }`, or `null` when the platform tree has
 *   no such plane file.
 */
function classifyPlane(plane) {
  const path = join(upstream, 'packages', 'bundle', plane, 'cordis.patch.yml')
  if (!existsSync(path)) return null
  const items = parsePatchItems(readFileSync(path, 'utf8'), path)
  return {
    path,
    disabled: items.filter(item => item.disabled === 'true').map(item => item.id),
    mounted: items.filter(item => item.name !== null).map(item => item.id),
  }
}

/**
 * Member names of every `interface Config` block in one platform source file.
 *
 * @param text - the file's content.
 * @returns the member names at the interface's top level (nested object members
 *   and JSDoc text are not collected).
 */
function configKeysIn(text) {
  const keys = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^export interface Config\b/.test(lines[index])) continue
    let depth = 0
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (cursor > index && depth === 1) {
        const member = /^\s+([A-Za-z0-9_]+)\??:/.exec(line)
        if (member !== null) keys.push(member[1])
      }
      for (const character of line) {
        if (character === '{') depth += 1
        else if (character === '}') depth -= 1
      }
      if (cursor > index && depth === 0) break
    }
  }
  return keys
}

/**
 * The platform `Config` key set of one overridden row, read from the platform
 * sources (the row module plus any base `Config` it extends).
 *
 * @param row - the platform plugin id.
 * @returns the deduplicated key names.
 */
function platformConfigKeys(row) {
  const keys = []
  for (const rel of PLATFORM_ROW_CONFIG_SOURCES[row] ?? []) {
    const path = join(upstream, 'packages', ...rel.split('/').slice(1))
    if (!existsSync(path)) continue
    keys.push(...configKeysIn(readFileSync(path, 'utf8')))
  }
  return [...new Set(keys)]
}

/**
 * Judge one declaration against one profile.
 *
 * @param item - the parsed patch item that carries the key.
 * @param key - the declared config key.
 * @param profile - profile id (`web` / `headless`).
 * @returns `{ reach, note }` for the report.
 */
function judge(item, key, profile) {
  if (item.disabled === 'true') return { reach: 'dead-row', note: 'the declaration disables the row it configures' }
  if (item.name !== null) return { reach: 'row-mounted', note: `mounted by ${item.file}` }
  const disabling = PROFILE_PLANES[profile].filter(plane => UPSTREAM_PLANES[plane].disabled.includes(item.id))
  const entry = composerEntry(item.id, key)
  if (disabling.length === 0) {
    // A row no plane disables is read at profile root. The composer entry, when
    // present, is an ADDITIONAL reach (presets under the disabled plane) — it is
    // reported, not required.
    return { reach: 'profile-root', note: entry === undefined ? '' : `also injected by the composer into composed presets` }
  }
  if (entry === undefined) return { reach: 'unreachable', note: `row disabled by ${disabling.join('+')}` }
  const missing = entry.anchors.filter(anchor => {
    const path = join(root, anchor.file)
    return !existsSync(path) || !readFileSync(path, 'utf8').includes(anchor.needle)
  })
  if (missing.length > 0) return { reach: 'unreachable', note: `composer reach declared but not implemented in ${missing.map(anchor => anchor.file).join(', ')}` }
  return { reach: 'preset-composer', note: `row disabled by ${disabling.join('+')}; anchor(s) verified: ${entry.anchors.map(anchor => anchor.file).join(', ')}` }
}

const declarations = []
for (const bundle of BUNDLE_PATCHES) {
  const file = join(root, bundle, 'cordis.patch.yml')
  if (!existsSync(file)) {
    console.error(`verify-declared-config: no bundle patch at ${file} — pass the evolution packages root (vacant guard: a missing bundle is not a pass)`)
    process.exit(2)
  }
  for (const item of parsePatchItems(readFileSync(file, 'utf8'), file)) {
    for (const key of item.configKeys) declarations.push({ bundle, item, key })
  }
}

if (declarations.length === 0) {
  console.error('verify-declared-config: no config declaration found in any bundle patch — refuse to report a pass on an empty parse (vacant guard)')
  process.exit(2)
}

/** @returns whether the platform table knows this row id (mounted or disabled by some plane). */
function knownRow(id) {
  return Object.values(UPSTREAM_PLANES).some(plane => plane.disabled.includes(id) || plane.mounted.includes(id))
}

const violations = []
const unknownRows = []
console.log(`verify-declared-config: declared config reach (evolution root: ${root})`)
for (const { bundle, item, key } of declarations) {
  const verdicts = Object.keys(PROFILE_PLANES).map(profile => {
    const verdict = judge(item, key, profile)
    if (verdict.reach === 'unreachable' || verdict.reach === 'dead-row') violations.push({ bundle, item, key, profile, verdict })
    return `${profile}=${verdict.reach}`
  })
  if (item.name === null && !knownRow(item.id)) unknownRows.push({ bundle, item })
  console.log(`  ${bundle.padEnd(18)} ${item.id.padEnd(22)} ${key.padEnd(28)} ${verdicts.join('  ')}`)
}

for (const { bundle, item, key, profile, verdict } of violations) {
  console.error(
    `verify-declared-config: ${strict ? 'FAIL' : 'WARN'} — ${bundle} declares ${item.id}.${key} (${item.file}:${item.line}) but profile "${profile}" has no plane that reads it (${verdict.note}). `
    + `Platform anchors: ${Object.entries(UPSTREAM_PLANES).map(([id, plane]) => `${id} ${plane.source}`).join('; ')}. `
    + 'Fix: add a preset-composer entry WITH its code anchor to COMPOSER_REACHED, move the declaration onto a row the plane keeps enabled, or stop declaring it and state the reach in the README.',
  )
}

if (unknownRows.length > 0) {
  const listed = [...new Set(unknownRows.map(entry => `${entry.bundle}:${entry.item.id}`))]
  // v31 GUARD-01: a patch row the platform table does not know means the row
  // was RENAMED or REMOVED upstream — the declared override reaches nothing,
  // and the old 'profile-root' verdict was a vacuous pass (even under
  // --strict). Fail loud; updating UPSTREAM_PLANES re-arms the guard.
  console.error(`verify-declared-config: ${strict ? 'FAIL' : 'WARN'} — overrides of row(s) this platform table does not know: ${listed.join(', ')} — the row was likely renamed/removed upstream, so the declared override reaches nothing. Re-check the upstream plane and add the row to UPSTREAM_PLANES.`)
  if (strict) process.exit(1)
}

/**
 * Platform drift checks (v33 G4.1 / G2.3). With `--upstream` the plane
 * classification and the overridden rows' `Config` key sets are recomputed from
 * the platform tree; every run additionally checks that the bundle patches name
 * each platform key in their whole-config-replacement note.
 *
 * @returns the drift messages, empty when the snapshot still matches.
 */
function upstreamDrift() {
  const drift = []
  if (upstream !== null) {
    for (const [plane, declared] of Object.entries(UPSTREAM_PLANES)) {
      const actual = classifyPlane(plane)
      if (actual === null) {
        drift.push(`${plane}: no platform plane file under ${join(upstream, 'packages', 'bundle', plane)} — point --upstream at the platform checkout root`)
        continue
      }
      console.log(`verify-declared-config: upstream ${plane} — disabled: ${actual.disabled.join(', ') || '(none)'}; mounted: ${actual.mounted.join(', ') || '(none)'}`)
      const tableOnly = declared.disabled.filter(id => !actual.disabled.includes(id))
      const platformOnly = actual.disabled.filter(id => !declared.disabled.includes(id))
      if (tableOnly.length > 0 || platformOnly.length > 0) {
        drift.push(`${plane}: disabled set drifted — the table disables ${tableOnly.join(', ') || '(none)'} that the platform keeps enabled, and the platform disables ${platformOnly.join(', ') || '(none)'} that the table omits`)
      }
      const notMounted = declared.mounted.filter(id => !actual.mounted.includes(id) || actual.disabled.includes(id))
      if (notMounted.length > 0) drift.push(`${plane}: the table lists ${notMounted.join(', ')} as mounted, but the platform does not mount that row enabled`)
    }
  }
  for (const [row, keys] of Object.entries(PLATFORM_ROW_CONFIG_KEYS)) {
    if (upstream !== null) {
      const actual = platformConfigKeys(row)
      if (actual.length === 0) {
        drift.push(`${row}: no platform \`interface Config\` found for ${row} under ${upstream} — the recomputation cannot confirm the snapshotted key set`)
      } else {
        const tableOnly = keys.filter(key => !actual.includes(key))
        const platformOnly = actual.filter(key => !keys.includes(key))
        if (tableOnly.length > 0 || platformOnly.length > 0) {
          drift.push(`${row}: platform Config keys drifted — the table lists ${tableOnly.join(', ') || '(none)'} that the platform no longer declares, and the platform declares ${platformOnly.join(', ') || '(none)'} that the table omits`)
        }
      }
    }
    for (const bundle of BUNDLE_PATCHES) {
      const path = join(root, bundle, 'cordis.patch.yml')
      if (!existsSync(path)) continue
      const text = readFileSync(path, 'utf8')
      const unnamed = keys.filter(key => !new RegExp(`(^|[^A-Za-z0-9_])${key}([^A-Za-z0-9_]|$)`).test(text))
      if (unnamed.length > 0) {
        drift.push(`${bundle}: the whole-config-replacement note has no mention of platform key(s) ${unnamed.join(', ')} for row ${row} — an override replaces \`config\` wholesale, so an unacknowledged key silently falls back to its schema default`)
      }
    }
  }
  return drift
}

const drift = upstreamDrift()
if (drift.length > 0) {
  console.error(`verify-declared-config: ${strict ? 'FAIL' : 'WARN'} — ${drift.length} upstream-planes-drift violation(s)${upstream === null ? ' (platform table only; pass --upstream <platform-tree> to recompute from the platform)' : ''}:`)
  console.error(drift.join('\n'))
}

const declared = declarations.length
const reaching = declared * Object.keys(PROFILE_PLANES).length - violations.length
console.log(
  `verify-declared-config: summary — ${declared} declaration(s) × ${Object.keys(PROFILE_PLANES).length} profile(s): ${reaching} reachable, ${violations.length} violation(s), ${drift.length} upstream-drift violation(s)`
  + (upstream === null ? ' (platform table not recomputed)' : ` (recomputed from ${upstream})`)
  + ((violations.length > 0 || drift.length > 0) && !strict ? ' (warn-only mode: pass --strict to fail)' : ''),
)
process.exit((violations.length > 0 || drift.length > 0) && strict ? 1 : 0)
