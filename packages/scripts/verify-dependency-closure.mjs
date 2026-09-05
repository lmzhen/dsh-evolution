#!/usr/bin/env node
/**
 * Dependency-closure guard (0.3.21, G0.1/F-105): every import of an
 * @deepseek-ai/* package from a package's `src/` MUST be declared in its
 * package.json dependencies or peerDependencies. Type-only imports are
 * counted too — the d.ts reference resolves through the same declaration,
 * and the published package has no tsconfig paths, so a missing declaration
 * breaks `dsh plugin add <pkg>` installs with ERR_MODULE_NOT_FOUND either
 * way.
 *
 * Severe (fail): missing declaration for any import whose target is not
 * declared in dependencies|peerDependencies. The multi-line type-only form
 * over-reports as a value import (safe direction); dynamic `import()` calls
 * are invisible to the line scanner (documented limitation).
 *
 * Usage: node verify-dependency-closure.mjs <packages-root>
 * Exit 0 when every package's imports are declared; exit 1 listing the
 * offenders — also when ZERO packages were inspected (a vacuous pass is the
 * F-103 class of silent guard; 0.3.26 V4-29).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root || !existsSync(root)) {
  console.error('usage: verify-dependency-closure.mjs <packages-root>')
  process.exit(2)
}

const scope = '@deepseek-ai/'
const offenders = []
let inspected = 0

function declared(pkg) {
  const set = new Set()
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[section] ?? {})) set.add(name)
  }
  return set
}

// A line is type-only when it carries no VALUE import: `import type {..}` /
// `export type {..}` / `import('...')` inline types are the only forms we
// exempt; a mixed `import { type A, b }` counts as a value import (safe:
// over-reports rather than under-reports).
function typeOnlyImport(line) {
  const body = line.trim()
  return /^import\s+type\b/.test(body)
    || /^export\s+type\b/.test(body)
    || /^import\s*\(\s*['"]@deepseek-ai\//.test(body)
}

for (const dir of readdirSync(root)) {
  const pkgDir = join(root, dir)
  const manifestPath = join(pkgDir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const srcDir = join(pkgDir, 'src')
  if (!existsSync(srcDir)) continue
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
  walk(srcDir)
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
    if (!has.has(name)) {
      offenders.push(`${dir}: value-import "${name}" (${usage.value ? 'value' : 'type-only'}) not declared in dependencies/peerDependencies`)
    }
  }
}

if (inspected === 0) {
  // V4-29 (0.3.26): no package manifests/src were inspected — a wrong root or
  // an empty tree must fail loud, never print an empty "OK" (F-103 class).
  console.error(`verify-dependency-closure: no package(s) inspected under ${root} — check the packages-root argument`)
  process.exit(1)
}

if (offenders.length > 0) {
  console.error(`verify-dependency-closure: ${offenders.length} undeclared import(s) across ${inspected} package(s):`)
  for (const line of offenders) console.error(`  - ${line}`)
  process.exit(1)
}
console.log(`verify-dependency-closure: OK — all value imports declared across ${inspected} package(s)`)
