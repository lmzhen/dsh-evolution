#!/usr/bin/env node
/**
 * DCR-85 activation-oracle gate: only `state/activation.ts` may open-code the
 * v2 marker. Every other consumer asks `isStoreV2Active(home)`; a second
 * decision point is how one process switches media at runtime and writes
 * legacy files after another host promoted the same home.
 *
 * Migration code is exempt because it owns the marker lifecycle.
 *
 * Usage: node packages/scripts/verify-store-activation-oracle.mjs packages [--self-test]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages'
const ALLOW = new Set([
  'evolution-core/src/state/activation.ts',
  'evolution-core/src/state/constants.ts',
  'evolution-core/src/state/migrate.ts',
])
const problems = []
let scanned = 0
const violation = text => text.includes('STATE_V2_MIGRATION_MARKER')

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'tests' || entry === 'dist' || entry === 'lib' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) { walk(path); continue }
    if (!entry.endsWith('.ts')) continue
    scanned += 1
    const rel = relative(root, path).replace(/\\/g, '/')
    if (ALLOW.has(rel)) continue
    const text = readFileSync(path, 'utf8')
    if (violation(text)) {
      problems.push(rel + ': references STATE_V2_MIGRATION_MARKER directly (use isStoreV2Active from state/activation.ts)')
    }
  }
}

for (const pkg of readdirSync(root)) {
  try { walk(join(root, pkg, 'src')) } catch { /* package without src */ }
}

if (process.argv.includes('--self-test')) {
  const fake = "import { STATE_V2_MIGRATION_MARKER } from './constants.ts'\nconst active = existsSync(join(home, 'state', STATE_V2_MIGRATION_MARKER))"
  if (!violation(fake) || violation("import { isStoreV2Active } from './activation.ts'")) {
    console.error('verify-store-activation-oracle: SELF-TEST FAILED — the rule is not discriminating')
    process.exit(1)
  }
  console.log('verify-store-activation-oracle: self-test OK — a direct marker reference is rejected; the helper import is not')
  process.exit(0)
}

if (scanned === 0) {
  console.error('verify-store-activation-oracle: a vacuum pass is not a pass — no source file matched')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-store-activation-oracle: ' + String(problems.length) + ' direct marker decision(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-store-activation-oracle: OK — ' + String(scanned) + ' source file(s) route the v2 decision through state/activation.ts')
