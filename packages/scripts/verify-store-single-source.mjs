#!/usr/bin/env node
/**
 * DCR-85 single-source gate: only the store kernel (and the explicit migration
 * command that publishes the first head) may name the store-v2 head/commit
 * paths. Any other package reading or writing them is a second medium.
 *
 * Usage: node packages/scripts/verify-store-single-source.mjs packages [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages'
const ALLOWED = [
  /evolution-core[\\/]src[\\/]store[\\/]/,
  /evolution-core[\\/]src[\\/]state[\\/]/,
]
const TOKENS = ['store-v2', 'head.json', 'commits/', 'objects/']
const problems = []
let scanned = 0

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'tests' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) { walk(path, visit); continue }
    if (entry.endsWith('.ts')) visit(path)
  }
}

for (const pkg of readdirSync(root)) {
  const src = join(root, pkg, 'src')
  try { walk(src, path => {
    if (ALLOWED.some(re => re.test(path))) return
    scanned += 1
    const text = readFileSync(path, 'utf8')
    for (const token of TOKENS) {
      if (text.includes(token)) problems.push(relative(root, path) + ' names the store-v2 medium (' + token + ') outside the kernel/migration')
    }
  }) } catch { /* a package without src is fine */ }
}

if (process.argv.includes('--self-test')) {
  const synthetic = 'packages/evolution-merge/src/fake.ts names store-v2 head.json'
  const detected = !ALLOWED.some(re => re.test(synthetic)) && TOKENS.some(token => synthetic.includes(token))
  if (!detected) {
    console.error('verify-store-single-source: SELF-TEST FAILED — an off-kernel head reference was not detected')
    process.exit(1)
  }
  console.log('verify-store-single-source: self-test OK — an off-kernel head reference turns the gate red')
  process.exit(0)
}

if (scanned === 0) {
  console.error('verify-store-single-source: a vacuum pass is not a pass — no source file matched')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-store-single-source: ' + String(problems.length) + ' off-kernel medium reference(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-store-single-source: OK — ' + String(scanned) + ' package source file(s) keep the store-v2 paths in the kernel/migration')
