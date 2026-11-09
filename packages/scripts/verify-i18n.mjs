#!/usr/bin/env node
/** Gate: one catalog source, eight locales, aligned keys and placeholders, fresh generated files. */
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..', '..')
const CATALOG = join(ROOT, 'packages/scripts/i18n/catalog')
const LOCALES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']

function checkRow(where, row, requireAll) {
  if (typeof row !== 'object' || row === null) throw new Error(where + ': row must be an object')
  const en = row.en
  if (typeof en !== 'string' || en.length === 0) throw new Error(where + ': en is required')
  const slots = [...en.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join('|')
  for (const locale of LOCALES) {
    const text = row[locale]
    if (typeof text !== 'string' || text.length === 0) {
      if (requireAll) throw new Error(where + ': missing ' + locale)
      continue
    }
    const own = [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join('|')
    if (own !== slots) throw new Error(where + ': ' + locale + ' placeholder mismatch')
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

const run = (script) => {
  const result = spawnSync(process.execPath, [join(ROOT, 'packages/scripts', script), '--strict', '--check'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(script + ' failed: ' + String(result.stderr) + String(result.stdout))
}
run('gen-i18n.mjs')
run('gen-param-i18n.mjs')
console.log('verify-i18n: OK — 4 namespace(s), ' + String(uiKeys) + ' UI key(s), ' + String(paramLeaves) + ' parameter leaf/leaves, 8 locales')
