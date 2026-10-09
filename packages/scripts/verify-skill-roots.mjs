/**
 * Do the shipped configs agree on the SKILL ROOT? (v43 audit S1-6 / G-5; A83/T7-09 rework.)
 *
 * Usage: node packages/scripts/verify-skill-roots.mjs <packages-root> [--strict]
 *
 * Every family row that resolves a skill tree goes through core's
 * `resolveSkillsRoot`, so a deployment can point ONE row at a different tree
 * with no other signal — and the maintenance sweep then audits that tree and
 * reports "clean" (the audit's G-5). doctor cannot catch it: its data plane is
 * the profile manifests, not the rows' config (see S1-6's re-scoping), so the
 * check belongs here, next to the other discovery gates.
 *
 * Which packages consume a skill root is DERIVED from their sources (a package
 * that calls `resolveSkillsRoot`/`resolveRootConfig`), never hand-listed — and
 * `root:` rows whose package does NOT consume one are reported as excluded
 * (with the package they belong to), because the family uses the same field name
 * for the STATE-storage path (`evolution-state-json`), which must never be
 * compared against a skill root.
 *
 * TWO judgements, both of which must be able to fail on the tree as shipped
 * (A83: until this rework the only failing comparison needed a declared `root:`
 * that the shipped rows do not carry, so the guard exited 0 while judging
 * nothing — a vacuum pass):
 *
 *   1. AGREEMENT over the EFFECTIVE roots of every skill-root consumer: the value
 *      its own row declares, or `DEFAULT_ROOT` when it declares none. One distinct
 *      value passes; two mean one row points where the others do not — the drift
 *      this guard exists to catch. This is non-vacuous with zero declared roots
 *      (all consumers then resolve the default), which is exactly the shipped
 *      state.
 *   2. NON-VACUITY of the scan itself: no package derived as a skill-root
 *      consumer (the probe string changed, or the tree is not a family tree)
 *      exits 2 and says the parse surface is empty — never a silent pass.
 *
 * Rows are parsed as BLOCKS (`- id:` starts one, deeper-indented lines belong to
 * it, a blank line or a line at the same-or-shallower indent ends it), so the key
 * order inside a row is irrelevant — the previous line-order scan attributed a
 * row whose `name:` followed its `root:` to nobody and silently excluded it.
 * @module verify-skill-roots
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const root = argv[0]
const strict = argv.includes('--strict')
if (typeof root !== 'string' || root === '') {
  console.error('usage: node verify-skill-roots.mjs <packages-root> [--strict]')
  process.exit(1)
}

/** The value a consumer resolves when its row declares no `root:` — the family default
 * (`$DSH_HOME/skills`, resolved by core). A string, never `undefined`, so it can take part in
 * the agreement comparison: the shipped tree declares no root at all, and the comparison has to
 * mean something there. */
const DEFAULT_ROOT = '(default: the tree core resolves, $DSH_HOME/skills)'

/** One `- id:` row of a shipped config, with the keys this guard reads (any order inside it).
 * @param text - the file's content.
 * @returns the rows in file order, each `{ id, line, name, root }`.
 */
function parseRows(text) {
  const rows = []
  let current = null
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const idMatch = /^(\s*)-\s*id:\s*(\S+)\s*$/.exec(line)
    if (idMatch) {
      current = { id: idMatch[2], line: index + 1, name: '', root: null }
      rows.push(current)
      continue
    }
    if (current === null) continue
    if (line.trim() === '') { current = null; continue }
    const indent = line.length - line.trimStart().length
    if (indent <= (current.indent ?? 0)) { current = null; continue }
    const nameMatch = /^\s*name:\s*'?([^'\s]+)'?\s*$/.exec(line)
    if (nameMatch && current.name === '') current.name = nameMatch[1]
    const rootMatch = /^\s*root:\s*(.+?)\s*$/.exec(line)
    if (rootMatch && current.root === null) current.root = rootMatch[1]
  }
  return rows
}

const packages = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
if (packages.length === 0) {
  console.error('verify-skill-roots: no package directory under ' + root + ' — nothing could be read, so this is not a pass')
  process.exit(2)
}
const nameOf = new Map()
for (const pkg of packages) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, pkg, 'package.json'), 'utf8'))
    if (typeof manifest.name === 'string') nameOf.set(manifest.name, pkg)
  } catch { /* not a package */ }
}

/** Packages whose sources resolve a SKILL root (derived, not hand-listed). */
const skillRootPackages = new Set()
for (const pkg of packages) {
  const srcDir = join(root, pkg, 'src')
  let files = []
  try { files = readdirSync(srcDir, { recursive: true }).map(String).filter(f => f.endsWith('.ts')) } catch { continue }
  for (const rel of files) {
    const full = join(srcDir, rel)
    try { if (!statSync(full).isFile()) continue } catch { continue }
    if (/resolveSkillsRoot\(|resolveRootConfig\(/.test(readFileSync(full, 'utf8'))) { skillRootPackages.add(pkg); break }
  }
}

const declared = []
const excluded = []
const unattributable = []
for (const pkg of packages) {
  const dir = join(root, pkg)
  let entries = []
  try { entries = readdirSync(dir) } catch { continue }
  for (const file of entries.filter(f => /^cordis.*\.ya?ml$/.test(f))) {
    for (const row of parseRows(readFileSync(join(dir, file), 'utf8'))) {
      if (row.root === null) continue
      const where = pkg + '/' + file + ' (row ' + row.id + ', ' + (row.name === '' ? '(no name)' : row.name) + ')'
      // Two different "not a family consumer" cases, and they must not be conflated:
      //   - the row names a package this tree does not ship (the platform's own rows are composed
      //     into the family's configs): legitimately excluded, and the report names it;
      //   - the row names NOTHING (a parse-shape failure, e.g. a key order the old line scan
      //     mis-read): the guard cannot tell which side it belongs to, so it fails loud.
      const shipped = nameOf.has(row.name)
      const entry = { where, value: row.root, owner: shipped ? nameOf.get(row.name) : row.name, shipped }
      if (row.name === '') unattributable.push(entry)
      else if (shipped && skillRootPackages.has(entry.owner)) declared.push(entry)
      else excluded.push(entry)
    }
  }
}

// The agreement comparison over EFFECTIVE roots (see the module docblock).
const effective = new Map()
for (const pkg of [...skillRootPackages].sort()) effective.set(pkg, DEFAULT_ROOT)
for (const entry of declared) effective.set(entry.owner, entry.value)
const distinct = [...new Set(effective.values())]
const summary = 'verify-skill-roots: skill-root consumers=' + skillRootPackages.size
  + ' declared-root-rows=' + declared.length
  + ' distinct-effective-roots=' + distinct.length
  + ' excluded(state/other)=' + excluded.length
  + ' unattributable=' + unattributable.length
console.log(summary)
for (const entry of declared) console.log('  declared: ' + entry.where + ' = ' + entry.value)
for (const entry of excluded) {
  const reason = entry.shipped ? 'row of ' + entry.owner + ', which resolves no skill root' : 'row of ' + entry.owner + ', a package this tree does not ship'
  console.log('  excluded (' + reason + '): ' + entry.where + ' = ' + entry.value)
}

// VACUITY (A83 method two): no consumer means the derivation premise collapsed — the probe
// string changed or this is not a family tree. A vacuum pass is not a pass.
if (skillRootPackages.size === 0) {
  console.error('verify-skill-roots: the parse surface is EMPTY — no package under ' + root + ' resolves a skill root (probe: resolveSkillsRoot(/resolveRootConfig(), so nothing was compared; exit 2 rather than report a pass')
  process.exit(2)
}

let failed = false
if (unattributable.length > 0) {
  failed = true
  console.error('  a root row names no package at all, so the guard cannot tell which side it belongs to:')
  for (const entry of unattributable) console.error('    ' + entry.where + ' = ' + entry.value)
}
if (distinct.length > 1) {
  failed = true
  console.error('  the consumers do not agree on the skill root:')
  for (const [pkg, value] of [...effective.entries()].sort()) console.error('    ' + pkg + ' = ' + value)
}
if (failed) process.exit(strict ? 1 : 0)
console.log('verify-skill-roots: OK — ' + skillRootPackages.size + ' consumer(s) resolve one skill root (declared rows: ' + declared.length + ')')
