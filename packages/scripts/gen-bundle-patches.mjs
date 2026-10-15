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
  const spec = roster.forms[form]
  const prefix = spec.rowPrefix ?? "    "
  const out = [...spec.header]
  // G2a/2a.3: `insert` is declared, not assumed - the standalone composition is a plain row list and
  // carries no `- insert:` line. Absent, it defaults to true and the three patch forms keep their byte
  // identity.
  if (spec.insert !== false) out.push("- insert:")
  let first = true
  // G2a/2a.3: `layout` is declared per form, because a form's banner SEGMENTS are not the same thing as
  // the roster's render groups: the standalone file splits two groups that the patches keep whole. Absent
  // a layout, this is exactly the group iteration the patches have always used.
  const layout = spec.layout ?? roster.groups.map((group) => ({ group: group.id }))
  for (const segment of layout) {
    const group = roster.groups.find((candidate) => candidate.id === segment.group)
    // G2a/2a.3: a segment may name the rows it covers. The standalone file's banner segments do NOT line
    // up with the roster's render groups (it splits two of them), so a group filter would silently DROP
    // the rows the split moved - a declaration is the only faithful spelling.
    const rows = segment.rows !== undefined
      ? segment.rows.map((id) => roster.rows.find((row) => row.id === id)).filter((row) => row !== undefined && row.forms.includes(form))
      : roster.rows.filter((row) => row.group === segment.group && row.forms.includes(form))
    if (rows.length === 0) continue
    const fallback = group === undefined ? undefined : (group.banners[form] ?? Object.values(group.banners).find((line) => typeof line === "string"))
    const banner = segment.banner ?? fallback
    const lines = Array.isArray(banner) ? banner : [banner]
    if (lines.length === 0 || !lines.every((line) => typeof line === "string")) {
      throw new Error("no banner for group " + segment.group + " in form " + form)
    }
    if (!first && spec.blankBetweenSegments !== false) out.push("")
    out.push(...lines)
    first = false
    for (const row of rows) {
      out.push(...(row.leads !== undefined && row.leads[form] !== undefined ? row.leads[form] : row.lead))
      out.push(prefix + "- id: " + row.id)
      out.push(...(row.bodies !== undefined && row.bodies[form] !== undefined ? row.bodies[form] : row.body))
    }
  }
  out.push(...(spec.tail ?? []))
  return out.join("\n") + "\n"
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
  // G2a/2a.3: the form-to-artifact mapping is DECLARED, not derived. A derived path cannot see a delivered
  // file that follows no form naming convention - the standalone composition is exactly that file, and an
  // undeclared one is the orphan the reverse check reports.
  // G2a/2a.3 fix: a DECLARED target is root-relative too. It used to be used as-is, so a declared
  // "evolution-preset/cordis.yml" resolved against the process CWD (the repo root) and the standalone
  // write landed outside the tree entirely (ENOENT). `resolve` keeps an absolute declaration working.
  const declared = roster.forms[form].target
  const target = declared === undefined ? join(root, "evolution-" + form, "cordis.patch.yml") : resolve(root, declared)
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
