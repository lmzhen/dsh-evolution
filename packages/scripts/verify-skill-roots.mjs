/**
 * Do the shipped configs agree on the SKILL ROOT? (v43 audit S1-6 / G-5.)
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
 * `root:` rows whose package does NOT consume one are reported as excluded,
 * because the family uses the same field name for the STATE-storage path
 * (`evolution-state-json`), which must never be compared against a skill root.
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

const packages = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
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
for (const pkg of packages) {
  const dir = join(root, pkg)
  let entries = []
  try { entries = readdirSync(dir) } catch { continue }
  for (const file of entries.filter(f => /^cordis.*\.ya?ml$/.test(f))) {
    const lines = readFileSync(join(dir, file), 'utf8').split(/\r?\n/)
    let rowId = ''
    let rowName = ''
    for (const line of lines) {
      const id = /^\s*-\s*id:\s*(\S+)/.exec(line)
      if (id !== null) { rowId = id[1]; rowName = ''; continue }
      const name = /^\s*name:\s*'?([^'\s]+)'?/.exec(line)
      if (name !== null) { rowName = name[1]; continue }
      const rootLine = /^\s*root:\s*(.+?)\s*$/.exec(line)
      if (rootLine === null) continue
      const owner = nameOf.get(rowName) ?? (nameOf.has(rowName) ? rowName : '')
      const entry = { where: pkg + '/' + file + ' (row ' + rowId + ', ' + rowName + ')', value: rootLine[1] }
      if (owner !== '' && skillRootPackages.has(owner)) declared.push(entry)
      else excluded.push(entry)
    }
  }
}

const distinct = [...new Set(declared.map(entry => entry.value))]
const summary = 'verify-skill-roots: skill-root rows with a declared root=' + declared.length
  + ' distinct=' + distinct.length + ' excluded(state/other)=' + excluded.length
console.log(summary)
for (const entry of excluded) console.log('  excluded (not a skill-root consumer): ' + entry.where + ' = ' + entry.value)
if (distinct.length > 1) {
  console.error('  the shipped configs disagree on the skill root:')
  for (const entry of declared) console.error('    ' + entry.where + ' = ' + entry.value)
  console.error('  Fix: point every skill-root row at the same tree (or leave them all unset so the family default applies).')
  if (strict) process.exit(1)
}
