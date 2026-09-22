#!/usr/bin/env node
/**
 * Generate the three bundle patches (all / host / preset) from the row roster.
 *
 * `bundle-rows.json` is the single source for the `- insert:` row list: a row's
 * membership in an install form is the `forms` field, and its YAML body plus the
 * comments attached to it are stored once when the forms share them. Everything
 * outside the insert section (the top-level override blocks) is form-specific
 * prose and stays verbatim in the roster's per-form `tail`.
 *
 * Deterministic: the same roster always renders the same bytes, which is what
 * makes '--check' a useful gate (a hand edit of a generated patch is drift).
 *
 * Usage: node gen-bundle-patches.mjs <evolution-root> [--check]
 *   --check  verify the three patches are current instead of writing them
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Render one form's patch file.
 * @param roster - the parsed roster.
 * @param form - one of the roster's form keys.
 * @returns the file text, ending in exactly one newline.
 */
function render(roster, form) {
  const out = [...roster.forms[form].header, '- insert:']
  let first = true
  for (const group of roster.groups) {
    const rows = roster.rows.filter((row) => row.group === group.id && row.forms.includes(form))
    if (rows.length === 0) continue
    const banner = group.banners[form] ?? Object.values(group.banners).find((line) => typeof line === 'string')
    if (typeof banner !== 'string') throw new Error('no banner for group ' + group.id + ' in form ' + form)
    if (!first) out.push('')
    out.push(banner)
    first = false
    for (const row of rows) {
      out.push(...(row.leads !== undefined && row.leads[form] !== undefined ? row.leads[form] : row.lead))
      out.push('    - id: ' + row.id)
      out.push(...(row.bodies !== undefined && row.bodies[form] !== undefined ? row.bodies[form] : row.body))
    }
  }
  out.push(...roster.forms[form].tail)
  return out.join('\n') + '\n'
}

const argv = process.argv.slice(2)
const rootArg = argv.find((arg) => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages')
const check = argv.includes('--check')
const unknown = argv.filter((arg) => arg.startsWith('--') && arg !== '--check')
if (unknown.length > 0) {
  console.error('gen-bundle-patches: unknown flag ' + unknown.join(', ') + ' — usage: node gen-bundle-patches.mjs <evolution-root> [--check]')
  process.exit(2)
}

const rosterPath = join(root, 'scripts', 'bundle-rows.json')
let roster
try {
  roster = JSON.parse(readFileSync(rosterPath, 'utf8'))
} catch (error) {
  console.error('gen-bundle-patches: cannot read the roster at ' + rosterPath + ' (' + (error instanceof Error ? error.message : String(error)) + ')')
  process.exit(2)
}

/**
 * Refuse a roster that would silently drop a row.
 *
 * `render` walks the groups and filters rows into them, so a row naming a group that
 * does not exist — or listing no form at all — simply never appears in any patch, and the
 * freshness check would still call the result up to date.
 * @param parsed - the parsed roster.
 */
function validate(parsed) {
  const known = new Set(parsed.groups.map((group) => group.id))
  for (const row of parsed.rows) {
    if (!known.has(row.group)) throw new Error('row ' + row.id + ' names unknown group ' + String(row.group))
    if (!Array.isArray(row.forms) || row.forms.length === 0) throw new Error('row ' + row.id + ' lists no install form')
    for (const form of row.forms) {
      if (!(form in parsed.forms)) throw new Error('row ' + row.id + ' names unknown form ' + String(form))
    }
  }
}

try {
  validate(roster)
} catch (error) {
  console.error('gen-bundle-patches: ' + (error instanceof Error ? error.message : String(error)) + ' — a dropped row is invisible in the generated patches')
  process.exit(2)
}

const forms = Object.keys(roster.forms)
let stale = 0
for (const form of forms) {
  const target = join(root, 'evolution-' + form, 'cordis.patch.yml')
  const rendered = render(roster, form)
  if (!check) {
    writeFileSync(target, rendered)
    console.log('gen-bundle-patches: wrote ' + target)
    continue
  }
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  if (current === rendered) continue
  stale += 1
  const onDisk = current === null ? [] : current.split('\n')
  const wanted = rendered.split('\n')
  let at = 0
  while (at < Math.max(onDisk.length, wanted.length) && onDisk[at] === wanted[at]) at += 1
  console.error('gen-bundle-patches: STALE — ' + target + ' differs from the roster at line ' + (at + 1))
  console.error('    on disk: ' + JSON.stringify((onDisk[at] ?? '<eof>').slice(0, 100)))
  console.error('    roster : ' + JSON.stringify((wanted[at] ?? '<eof>').slice(0, 100)))
}
if (check) {
  if (stale > 0) {
    console.error('gen-bundle-patches: ' + stale + ' of ' + forms.length + ' patch file(s) stale — run `node packages/scripts/gen-bundle-patches.mjs packages`')
    process.exit(1)
  }
  console.log('gen-bundle-patches: OK — ' + forms.length + ' patch file(s) match the roster')
}
