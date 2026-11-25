#!/usr/bin/env node
/**
 * DCR-85 tree-manifest gate: a tree manifest may only be written inside the
 * commit transaction (`StoreMutation.treeManifest`). Pre-commit `putObject` /
 * `publishTreeManifest*` helpers were removed because a concurrent GC could see
 * the uncommitted object; a reintroduction must be reviewed as a new design, not
 * slipped in as a helper.
 *
 * Usage: node packages/scripts/verify-store-manifest.mjs packages [--self-test]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages'
const problems = []
let scanned = 0
const forbidden = ['putObject(', 'publishTreeManifest(', 'publishTreeManifestFiles(']
const violation = text => forbidden.some(token => text.includes(token))

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'tests' || entry === 'dist' || entry === 'lib' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) { walk(path); continue }
    if (!entry.endsWith('.ts')) continue
    scanned += 1
    const rel = relative(root, path).replace(/\\/g, '/')
    if (violation(readFileSync(path, 'utf8'))) {
      problems.push(rel + ': uses a pre-commit object/manifest writer; use StoreMutation.treeManifest inside mutate()')
    }
  }
}

for (const pkg of readdirSync(root)) {
  try { walk(join(root, pkg, 'src')) } catch { /* package without src */ }
}

const kernel = readFileSync(join(root, 'evolution-core/src/store/store-kernel.ts'), 'utf8')
if (!kernel.includes('request.treeManifest')) {
  problems.push('evolution-core/src/store/store-kernel.ts: does not apply treeManifest inside the mutation transaction')
}

if (process.argv.includes('--self-test')) {
  if (!violation("await kernel.putObject(manifest)") || violation('treeManifest: manifest')) {
    console.error('verify-store-manifest: SELF-TEST FAILED — the rule is not discriminating')
    process.exit(1)
  }
  console.log('verify-store-manifest: self-test OK — a pre-commit object writer is rejected; the transactional field is not')
  process.exit(0)
}

if (scanned === 0) {
  console.error('verify-store-manifest: a vacuum pass is not a pass — no source file matched')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-store-manifest: ' + String(problems.length) + ' manifest violation(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-store-manifest: OK — ' + String(scanned) + ' source file(s); manifests are written only inside the commit transaction')
