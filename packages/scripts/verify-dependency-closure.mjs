#!/usr/bin/env node
/**
 * Dependency-closure guard (0.3.21, G0.1/F-105; forward half 0.3.75, v41 P2-24).
 *
 * BACKWARD (0.3.21): every import of an @deepseek-ai/* package from a
 * package's `src/` MUST be declared in its package.json dependencies or
 * peerDependencies. Type-only imports are counted too — the d.ts reference
 * resolves through the same declaration, and the published package has no
 * tsconfig paths, so a missing declaration breaks `dsh plugin add <pkg>`
 * installs with ERR_MODULE_NOT_FOUND either way.
 *
 * Severe (fail): missing declaration for any import whose target is not
 * declared in dependencies|peerDependencies. The multi-line type-only form
 * over-reports as a value import (safe direction); only a dynamic `import()`
 * NOT at line start is invisible to the line scanner (documented limitation —
 * v21 S-7: line-start `import('…')` is now counted as the value import it is).
 *
 * FORWARD (0.3.75): every declaration in
 * dependencies|peerDependencies|optionalDependencies|devDependencies MUST have
 * a reference site inside its own package. This is the same closure read from
 * the other end, and it closes the rot class the backward half cannot see: a
 * declaration with no import can never fail a build, so it survives every
 * refactor — 71 of them (58 the retired @deepseek-ai/dsh-invariants companion)
 * had accumulated across 29 packages, shipping phantom platform ranges in
 * every published manifest.
 *
 * A reference site is a QUOTED specifier — `from 'X'`, `import('X')`,
 * `require("X")`, a tsconfig "paths"/"references" key, a bundle row
 * `name: 'X'` — or a subpath of one (`X/tools`). Comments and README prose
 * are deliberately NOT sites: a bare prose mention (no quotes) kept the
 * dsh-invariants declarations alive for a whole release line. `@types/foo`
 * counts as referenced when `foo` is — TS derives the types package from the
 * import, so the pair states ONE fact.
 *
 * Usage: node verify-dependency-closure.mjs <packages-root> [--json]
 * Exit 0 when both directions are closed; exit 1 listing the offenders — also
 * when ZERO packages were inspected (a vacuous pass is the F-103 class of
 * silent guard; 0.3.26 V4-29). `--json` prints the same findings as one
 * object so a fixer/test consumes THIS rule instead of restating it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'

const root = process.argv[2]
if (!root || !existsSync(root)) {
  console.error('usage: verify-dependency-closure.mjs <packages-root> [--json]')
  process.exit(2)
}
// Unknown flags are a typo surface: a misspelled `--stict` must fail loud,
// never silently run the default (both directions are always enforced;
// --strict is accepted as the shared gate-chain spelling).
const KNOWN_FLAGS = new Set(['--json', '--strict'])
const unknownFlags = process.argv.slice(3).filter(arg => !KNOWN_FLAGS.has(arg))
if (unknownFlags.length > 0) {
  console.error(`usage: verify-dependency-closure.mjs <packages-root> [--json] — unknown flag: ${unknownFlags.join(' ')}`)
  process.exit(2)
}
const asJson = process.argv.includes('--json')

const scope = '@deepseek-ai/'
const offenders = []
const unreferenced = []
const undeclaredAssets = []

/**
 * Does the manifest's \`files\` list cover this package-relative path? npm
 * semantics: an exact entry matches, a directory entry covers its subtree, and
 * a "star" matches inside one segment (the only glob npm documents there).
 */
function coveredByFiles(list, rel) {
  if (!Array.isArray(list)) return false
  for (const raw of list) {
    let pattern = String(raw)
    if (pattern.startsWith('./')) pattern = pattern.slice(2)
    if (pattern.endsWith('/')) pattern = pattern.slice(0, -1)
    if (pattern === rel || rel.startsWith(pattern + '/')) return true
    if (!pattern.includes('*')) continue
    const segments = pattern.split('*')
    let cursor = 0
    let matched = true
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (index === 0) {
        if (!rel.startsWith(segment)) { matched = false; break }
        cursor = segment.length
        continue
      }
      const found = rel.indexOf(segment, cursor)
      if (found === -1) { matched = false; break }
      if (index === segments.length - 1 && found + segment.length !== rel.length) { matched = false; break }
      cursor = found + segment.length
    }
    if (matched) return true
  }
  return false
}
let inspected = 0
let declarationCount = 0
let assetCount = 0

function declared(pkg) {
  const set = new Set()
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[section] ?? {})) set.add(name)
  }
  return set
}

// A line is type-only when it carries no VALUE import: `import type {..}` /
// `export type {..}` are the only forms we exempt; a mixed
// `import { type A, b }` counts as a value import (safe: over-reports rather
// than under-reports). v21 (S-7): the former third exemption
// (`/^import\s*\(\s*['"]@deepseek-ai\//`) also matched a LINE-START dynamic
// value import (`import('@deepseek-ai/x').then(…)`), which is a REAL runtime
// dependency — an undeclared one was silently waived (under-report, the
// opposite of this file's declared failure direction). Inline type positions
// (`foo: import('…').T`) never START a line with `import(`, and the rare
// wrapped type-only continuation now over-reports — the safe direction.
function typeOnlyImport(line) {
  const body = line.trim()
  return /^import\s+type\b/.test(body)
    || /^export\s+type\b/.test(body)
}

// Reference sites only ever quote a specifier, so the scan reads quoted text —
// never a bare word. Subpaths (`X/tools`, `X/invariant`) are the same fact as
// the parent declaration: one manifest entry satisfies them all.
const QUOTES = ["'", '"', '`']

function referenced(text, name) {
  for (const quote of QUOTES) {
    const base = quote + name
    let at = text.indexOf(base)
    while (at !== -1) {
      const after = text[at + base.length]
      if (after === quote || after === '/') return true
      at = text.indexOf(base, at + 1)
    }
  }
  return false
}

// TS resolves `@types/foo` from an `import … from 'foo'` alone: the types
// package has no specifier of its own to find, so it is referenced exactly
// when its subject is. Everything else must be quoted by name.
function referenceSubjects(name) {
  return name.startsWith('@types/') ? [name, name.slice('@types/'.length)] : [name]
}

const REFERENCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml'])
const SKIP_DIR = new Set(['node_modules', 'lib', 'dist'])

for (const dir of readdirSync(root)) {
  const pkgDir = join(root, dir)
  const manifestPath = join(pkgDir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const srcDir = join(pkgDir, 'src')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const has = declared(manifest)
  const seen = new Map() // name -> { value: boolean; typeOnly: boolean }
  const files = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(full)
    }
  }
  if (existsSync(srcDir)) walk(srcDir)
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      const from = line.match(/from\s+['"](@deepseek-ai\/[A-Za-z0-9._/-]+)['"]/)
      if (!from) continue
      const name = from[1]
      const found = seen.get(name) ?? { value: false, typeOnly: false }
      if (typeOnlyImport(line)) found.typeOnly = true
      else found.value = true
      seen.set(name, found)
    }
  }
  inspected += 1
  for (const [name, usage] of seen) {
    if (!has.has(name)) offenders.push({ pkg: dir, name, kind: usage.value ? 'value' : 'type-only' })
  }
  // Forward: scan every code/config file in the package, minus its own
  // manifest (self-mention would make every declaration look used).
  const referenceText = []
  const collect = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIR.has(entry.name)) collect(join(d, entry.name))
        continue
      }
      if (entry.name === 'package.json') continue
      if (REFERENCE_EXT.has(extname(entry.name))) referenceText.push(readFileSync(join(d, entry.name), 'utf8'))
    }
  }
  collect(pkgDir)
  // 0.3.78 incident: evolution-core's lib reads ../persisted-write-inventory.json
  // at module scope, the manifest's files[] did not list it, and the PUBLISHED
  // package threw ENOENT on import — the whole family failed to load in the GUI
  // while every gate stayed green (they all run from the source tree, which HAS
  // the file). An asset the code reaches for BY PATH must be declared, or it is
  // not in the tarball.
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/new URL\(\s*'([^']+)'\s*,\s*import\.meta\.url\s*\)/g)) {
      const target = match[1]
      if (target.includes('://') || target.startsWith('data:')) continue
      const abs = resolve(dirname(file), target)
      if (!existsSync(abs) || !abs.startsWith(resolve(pkgDir))) continue
      const rel = relative(pkgDir, abs).split('\\').join('/')
      assetCount += 1
      if (coveredByFiles(manifest.files, rel)) continue
      undeclaredAssets.push({ pkg: dir, asset: rel, from: relative(pkgDir, file).split('\\').join('/') })
    }
  }
  const haystack = referenceText.join('\n')
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      declarationCount += 1
      if (referenceSubjects(name).some(subject => referenced(haystack, subject))) continue
      unreferenced.push({ pkg: dir, name, section })
    }
  }
}

const report = {
  ok: inspected > 0 && offenders.length === 0 && unreferenced.length === 0 && undeclaredAssets.length === 0,
  packages: inspected,
  declarations: declarationCount,
  offenders,
  unreferenced,
  undeclaredAssets,
}

if (inspected === 0) {
  // V4-29 (0.3.26): no package manifests/src were inspected — a wrong root or
  // an empty tree must fail loud, never print an empty "OK" (F-103 class).
  if (asJson) console.log(JSON.stringify(report))
  else console.error(`verify-dependency-closure: no package(s) inspected under ${root} — check the packages-root argument`)
  process.exit(1)
}

if (!report.ok) {
  if (asJson) console.log(JSON.stringify(report))
  else {
    if (offenders.length > 0) {
      console.error(`verify-dependency-closure: ${offenders.length} undeclared import(s) across ${inspected} package(s):`)
      for (const o of offenders) console.error(`  - ${o.pkg}: value-import "${o.name}" (${o.kind}) not declared in dependencies/peerDependencies`)
    }
    if (unreferenced.length > 0) {
      console.error(`verify-dependency-closure: ${unreferenced.length} unreferenced declaration(s) across ${inspected} package(s) — drop the declaration, or import what it names:`)
      for (const u of unreferenced) console.error(`  - ${u.pkg}: declares "${u.name}" (${u.section}) but no file in the package references it`)
    }
    if (undeclaredAssets.length > 0) {
      console.error('verify-dependency-closure: ' + undeclaredAssets.length + ' package-root asset(s) the code reads by path but files[] does not publish — the tarball throws ENOENT at import:')
      for (const a of undeclaredAssets) console.error('  - ' + a.pkg + ': ' + a.from + ' reads "' + a.asset + '", not covered by files[]')
    }
  }
  process.exit(1)
}
if (asJson) console.log(JSON.stringify(report))
else console.log(`verify-dependency-closure: OK — 0 undeclared import(s), ${declarationCount} declaration(s) all referenced, ${assetCount} package-root asset(s) published, across ${inspected} package(s)`)
