#!/usr/bin/env node
/**
 * DCR-85 lifecycle gate: optional family services must be resolved at USE time.
 *
 * Forbids:
 *  - a field/assignment capturing ctx.get('evolutionStore'|'evolutionMutationAuthority');
 *  - a required `inject` listing either optional service (Cordis inject is required:
 *    adding it drops the whole row when the service is absent — PR #26 / issue #23).
 *
 * Usage: node packages/scripts/verify-store-lifecycle.mjs packages [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages'
const OPTIONAL = ['evolutionStore', 'evolutionMutationAuthority']
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

function audit(path, text) {
  const rel = relative(root, path)
  for (const name of OPTIONAL) {
    // Field/const capture of the optional service at construction time.
    const capture = new RegExp('(?:this\\.[A-Za-z_$][\\w$]*|(?:private|readonly|protected)\\s+[A-Za-z_$][\\w$]*)\\s*(?:=|:)[^;\\n]*ctx\\.get\\(\\s*[\'"]' + name + '[\'"]')
    if (capture.test(text)) problems.push(rel + ': captures ctx.get(\'' + name + '\') in a field (use a use-time resolver)')
    // Required inject must not carry an optional capability.
    const inject = /export const inject\s*=\s*\[([^\]]*)\]/.exec(text)
    if (inject !== null && new RegExp('[\'"]' + name + '[\'"]').test(inject[1])) {
      problems.push(rel + ': lists optional ' + name + ' in required inject')
    }
  }
}

for (const pkg of readdirSync(root)) {
  const src = join(root, pkg, 'src')
  try { walk(src, path => { scanned += 1; audit(path, readFileSync(path, 'utf8')) }) } catch { /* package without src */ }
}

if (process.argv.includes('--self-test')) {
  const fake = "private store = ctx.get('evolutionStore')\nexport const inject = ['tools', 'evolutionMutationAuthority']"
  const before = problems.length
  audit('packages/fake/src/index.ts', fake)
  const detected = problems.length > before
  problems.length = before
  if (!detected) {
    console.error('verify-store-lifecycle: SELF-TEST FAILED — a constructor capture/required inject was not detected')
    process.exit(1)
  }
  console.log('verify-store-lifecycle: self-test OK — constructor capture and required optional inject both turn the gate red')
  process.exit(0)
}

if (scanned === 0) {
  console.error('verify-store-lifecycle: a vacuum pass is not a pass — no source file matched')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-store-lifecycle: ' + String(problems.length) + ' lifecycle violation(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-store-lifecycle: OK — ' + String(scanned) + ' package source file(s) resolve optional services at use time')
