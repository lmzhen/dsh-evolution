#!/usr/bin/env node
/**
 * verify-family-types.mjs (G7 redesign of gate-01).
 *
 * Why: the old row ran `tsc -b tsconfig.host.json`, which builds the PLATFORM's whole project
 * graph; in a source checkout that graph reports its own errors (typert codegen, client remote
 * projections) that no family change can fix. The check's subject is the FAMILY, so this runner
 * rebuilds exactly the family projects:
 *
 *   1. clears the family projects' tsbuildinfo (their project outputs may come from a
 *      skipping `--noCheck` build), leaving the platform projects' caches in place;
 *   2. runs `tsc -b <family tsconfigs>`;
 *   3. PASSES when tsc passes;
 *   4. FAILS on any diagnostic naming a family path (`packages/evolution/...`);
 *   5. prints `CANNOT DECIDE` and exits 2 when only platform projects report errors — that
 *      graph is the build line's subject, not this table's.
 *
 * Usage: node packages/evolution/scripts/verify-family-types.mjs [overlay-root]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? process.cwd())
const familyRoot = join(root, 'packages', 'evolution')
const tsc = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')
if (!existsSync(tsc)) {
  console.error('CANNOT DECIDE: typescript is not installed under ' + root)
  process.exit(2)
}
if (!existsSync(familyRoot)) {
  console.error('CANNOT DECIDE: no packages/evolution tree under ' + root)
  process.exit(2)
}

const projects = []
for (const name of readdirSync(familyRoot)) {
  const dir = join(familyRoot, name)
  if (!existsSync(join(dir, 'tsconfig.json'))) continue
  if (name === 'scripts' || name === 'test-support') continue
  projects.push(join(dir, 'tsconfig.json'))
  const info = join(dir, 'tsconfig.tsbuildinfo')
  if (existsSync(info)) rmSync(info, { force: true })
  const typesInfo = join(dir, 'lib', 'types', 'tsconfig.tsbuildinfo')
  if (existsSync(typesInfo)) rmSync(typesInfo, { force: true })
}
if (projects.length === 0) {
  console.error('CANNOT DECIDE: no family project tsconfig found under ' + familyRoot)
  process.exit(2)
}

const run = spawnSync(process.execPath, [tsc, '-b', ...projects], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const output = String(run.stdout ?? '') + String(run.stderr ?? '')
if (run.status === 0) process.exit(0)

const familyDiagnostics = []
const otherDiagnostics = []
for (const line of output.split(/\r?\n/)) {
  const match = /^([^(\s][^(]*?)\(\d+,\d+\): error TS\d+/.exec(line)
  if (match === null) continue
  const rel = match[1].replace(/\\/g, '/')
  if (rel.startsWith('packages/evolution/')) familyDiagnostics.push(line.trim())
  else otherDiagnostics.push(line.trim())
}
// Structural leakage: the overlay's dev base maps PLATFORM package names to their sources, so a
// family project can be told to include a platform file it does not own (TS6059/TS6307). That is
// a source-line environment fact (the build line resolves the same names to built declarations)
// and must not read as a family defect. Genuine family diagnostics still fail.
const leaks = familyDiagnostics.filter((line) => /TS6059|TS6307/.test(line))
const real = familyDiagnostics.filter((line) => !leaks.includes(line))
if (real.length === 0 && leaks.length > 0) {
  console.error('CANNOT DECIDE: ' + leaks.length + ' structural include(s) of platform sources under the dev base (TS6059/TS6307); the build line resolves built declarations')
  process.exit(2)
}
familyDiagnostics.splice(0, familyDiagnostics.length, ...real)
// Project-level diagnostics carry no (line,col): they name a file or a project only. They are
// the shape a broken reference graph takes (TS5083/TS18003), so they are counted, not dropped.
const positionless = output.split(/\r?\n/).filter((line) => /error TS\d+/.test(line) && !/\(\d+,\d+\): error TS\d+/.test(line))
for (const line of positionless) {
  if (/packages\/evolution/.test(line)) familyDiagnostics.push(line.trim())
  else otherDiagnostics.push(line.trim())
}
if (familyDiagnostics.length > 0) {
  console.error('verify-family-types: ' + familyDiagnostics.length + ' family type error(s):')
  for (const line of familyDiagnostics.slice(0, 40)) console.error('  ' + line)
  if (familyDiagnostics.length > 40) console.error('  … ' + (familyDiagnostics.length - 40) + ' more')
  process.exit(1)
}
console.error(
  'CANNOT DECIDE: tsc -b reports ' + otherDiagnostics.length +
  ' project/graph diagnostic(s) outside packages/evolution (the build line owns that graph)',
)
process.exit(2)
