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
 * UPSTREAM_PLANES holds the platform facts (which rows a plane disables) with
 * their upstream file:line anchors: the mirror does not carry
 * `packages/bundle/**`, so this table is the repository's record of them and
 * the thing to re-check whenever an upstream bundle changes. A row the table
 * does not know is reported as `unknown-row` (warn) — never silently assumed
 * reachable.
 *
 * 0.3.68 (v27 G3.1): WARN mode by default — batch 3 wires each new gate in warn
 * mode for one release before flipping it, matching verify-arch-guards. Pass
 * `--strict` (or set DSH_EVOLUTION_DECLARED_CONFIG_STRICT=1) to fail loud.
 *
 * Usage (works from BOTH layouts — dev `packages/evolution/scripts/…`, flat
 * mirror `packages/scripts/…`; the root argument is the evolution packages tree
 * in either layout, and the composer anchors resolve relative to it):
 *   node <scripts-dir>/verify-declared-config.mjs <evolution-root> [--strict]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'packages/evolution')
const strict = process.argv.includes('--strict') || process.env.DSH_EVOLUTION_DECLARED_CONFIG_STRICT === '1'

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
 * Platform plane facts. `disabled` lists the plugin ids the plane turns OFF at
 * profile root; `mounted` lists the ids this table has confirmed the plane
 * mounts enabled (the rows the family overrides). Every other row is
 * `unknown-row`: reported, never assumed reachable.
 */
const UPSTREAM_PLANES = {
  base: {
    disabled: ['skill-badge'],
    mounted: ['session-query-sqlite', 'tool-skill'],
    source: 'packages/bundle/base/cordis.patch.yml:117-121 (session-query-sqlite mounted with path/openAt), :243-245 (skill-badge disabled:true), :247-248 (tool-skill mounted, no config)',
  },
  'web-app': {
    disabled: ['skill-filesystem', 'tool-skill'],
    mounted: [],
    source: 'packages/bundle/web-app/cordis.patch.yml:330-333 (skill-filesystem and tool-skill both disabled:true — the platform moves the per-agent skill rows into presets)',
  },
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
  console.log(`verify-declared-config: notice — overrides of row(s) this platform table does not know: ${listed.join(', ')} — re-check the upstream plane and add them to UPSTREAM_PLANES`)
}

const declared = declarations.length
const reaching = declared * Object.keys(PROFILE_PLANES).length - violations.length
console.log(
  `verify-declared-config: summary — ${declared} declaration(s) × ${Object.keys(PROFILE_PLANES).length} profile(s): ${reaching} reachable, ${violations.length} violation(s)`
  + (violations.length > 0 && !strict ? ' (warn-only mode: pass --strict to fail)' : ''),
)
process.exit(violations.length > 0 && strict ? 1 : 0)
