#!/usr/bin/env node
/** Gate: one catalog source, eight locales, aligned keys and placeholders, fresh generated files. */
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { publishableDirs } from './lib-family-packages.mjs'

const SCRIPTS = import.meta.dirname
const EVOLUTION_ROOT = resolve(SCRIPTS, '..')
const CATALOG = join(SCRIPTS, 'i18n/catalog')
const LOCALES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']

function checkRow(where, row, requireAll) {
  if (typeof row !== 'object' || row === null) throw new Error(where + ': row must be an object')
  const en = row.en
  if (typeof en !== 'string' || en.length === 0) throw new Error(where + ': en is required')
  const slots = [...en.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join('|')
  const percentSlots = [...en.matchAll(/%a(\d+)%/g)].map(m => m[1]).sort().join('|')
  for (const locale of LOCALES) {
    const text = row[locale]
    if (typeof text !== 'string' || text.length === 0) {
      if (requireAll) throw new Error(where + ': missing ' + locale)
      continue
    }
    const own = [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join('|')
    if (own !== slots) throw new Error(where + ': ' + locale + ' placeholder mismatch')
    const ownPercent = [...text.matchAll(/%a(\d+)%/g)].map(m => m[1]).sort().join('|')
    if (ownPercent !== percentSlots) throw new Error(where + ': ' + locale + ' %aN% placeholder mismatch')
  }
}

const uiFiles = (await readdir(CATALOG)).filter(name => name.startsWith('ui.') && name.endsWith('.json'))
if (uiFiles.length !== 4) throw new Error('expected 4 ui.*.json catalogs, got ' + String(uiFiles.length))
let uiKeys = 0
for (const file of uiFiles) {
  const value = JSON.parse(await readFile(join(CATALOG, file), 'utf8'))
  if (typeof value.namespace !== 'string') throw new Error(file + ': namespace required')
  const keys = Object.keys(value.messages ?? {})
  if (keys.length === 0) throw new Error(file + ': no messages')
  for (const key of keys) checkRow(file + '.' + key, value.messages[key], true)
  uiKeys += keys.length
}

const param = JSON.parse(await readFile(join(CATALOG, 'param-copy.json'), 'utf8'))
let paramLeaves = 0
for (const [id, row] of Object.entries(param.groups)) { checkRow('group.' + id, row, true); paramLeaves++ }
for (const [id, row] of Object.entries(param.units)) { checkRow('unit.' + id, row, true); paramLeaves++ }
for (const [id, field] of Object.entries(param.fields)) {
  checkRow('field.' + id + '.label', field.label, true); paramLeaves++
  checkRow('field.' + id + '.hint', field.hint, true); paramLeaves++
}
for (const [id, rows] of Object.entries(param.values)) for (const [value, row] of Object.entries(rows)) {
  checkRow('field.' + id + '.value.' + value, row, true); paramLeaves++
}

const host = JSON.parse(await readFile(join(CATALOG, 'host.errors.json'), 'utf8'))
let hostKeys = 0
for (const [id, row] of Object.entries(host.messages ?? {})) { checkRow('host.error.' + id, row, true); hostKeys++ }
const commandHelp = JSON.parse(await readFile(join(CATALOG, 'host.commands.json'), 'utf8'))
let commandKeys = 0
for (const [id, row] of Object.entries(commandHelp.messages ?? {})) { checkRow('host.command.' + id, row, true); commandKeys++ }

const pluginMeta = JSON.parse(await readFile(join(CATALOG, 'plugin-meta.json'), 'utf8'))
let pluginRows = 0
for (const [key, row] of Object.entries(pluginMeta.messages ?? {})) { checkRow('plugin-meta.' + key, row, true); pluginRows++ }
const pluginDetail = JSON.parse(await readFile(join(CATALOG, 'plugin-detail.json'), 'utf8'))
for (const [key, row] of Object.entries(pluginDetail.messages ?? {})) { checkRow('plugin-detail.' + key, row, true); pluginRows++ }

// Independent census: the catalog set must equal the PUBLISHED package set, by directory. Both are
// read from their own source (catalog keys vs publishableDirs), so a new package cannot ship with an
// English-only inventory row because nobody remembered to add a catalog entry — the failure this
// whole axis exists for (the plugin-detail screen stayed English for a release).
const catalogPackages = new Set(Object.keys(pluginMeta.messages ?? {}).map(key => key.slice(0, key.indexOf('.'))))
// G8-B1/B2: rows for absorbed packages still mount, now as subpaths of a surviving package.
// Moving their metadata into the host package's locale tree (and teaching the resolver about it)
// is one batched migration — designs/W9-structure.md §9 owns it — so these directories are
// neither required nor orphaned until then.
const MERGED_AWAY = new Set(['evolution-contract', 'evolution-io', 'evolution-io-node', 'evolution-authority', 'evolution-policy', 'evolution-state-storage', 'evolution-state-json', 'evolution-skill-catalog', 'skill-usage', 'memory-files', 'tool-memory', 'evolution-feedback', 'evolution-replay', 'evolution-learning-graph', 'evolution-threat', 'evolution-state-domain'])
for (const directory of MERGED_AWAY) catalogPackages.delete(directory)
const published = publishableDirs(EVOLUTION_ROOT)
const missingRows = published.filter(directory => !catalogPackages.has(directory))
const orphanRows = [...catalogPackages].filter(directory => !published.includes(directory))
if (missingRows.length > 0) throw new Error('plugin-meta has no row for published package(s): ' + missingRows.join(', '))
if (orphanRows.length > 0) throw new Error('plugin-meta names package(s) the tree does not publish: ' + orphanRows.join(', '))
for (const directory of [...catalogPackages].sort()) {
  const titles = Object.keys(pluginMeta.messages).filter(key => key.startsWith(directory + '.title'))
  const descriptions = Object.keys(pluginMeta.messages).filter(key => key.startsWith(directory + '.description'))
  if (titles.length !== 1 || descriptions.length !== 1) throw new Error(directory + ': plugin-meta needs exactly one title and one description row')
}

const run = (script) => {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), '--strict', '--check'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(script + ' failed: ' + String(result.stderr) + String(result.stdout))
}
run('gen-i18n.mjs')
run('gen-param-i18n.mjs')
run('gen-host-errors.mjs')
run('gen-host-commands.mjs')
console.log('verify-i18n: OK — 4 namespace(s), ' + String(uiKeys) + ' UI key(s), ' + String(paramLeaves) + ' parameter leaf/leaves, ' + String(hostKeys) + ' host error(s), ' + String(commandKeys) + ' command-help key(s), 8 locales')
