#!/usr/bin/env node
/**
 * verify-regression-set — the merge-time regression set in ONE runnable place (v46 S1.11).
 *
 * Three groups, and this runner is explicit about which ones it could execute:
 *   1. guards — the in-repo guard scripts (the gate table's mirror side), each with --strict;
 *   2. specs  — the specs that carry the state-machine and contract semantics
 *               (approval.spec.ts = the concurrency branches, routes.spec.ts = the route literals,
 *               bundle-mutual-exclusion.spec.ts = the three-way patch pin). They run through the
 *               overlay's vitest, since the family packages' dependencies live there;
 *   3. audit  — the audit-side self-checks (surface denominator, object mapping, id-level coverage
 *               diff, the four-reason rule) live OUTSIDE this repository: pass --audit-dir to run
 *               them, otherwise they are reported as NOT executed.
 * 「Not executed」 is a printed state, never a silent pass (the O1 discipline).
 *
 * Usage: node <scripts-dir>/verify-regression-set.mjs <evolution-root>
 *          [--upstream <platform tree that carries node_modules/vitest>] [--audit-dir <audit dir>]
 *   --strict  accepted for uniformity; this one always fails loud on an executed failure.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Group 1: [script, ...args] — every entry must exit 0. */
const GUARDS = [
  ['verify-dependency-closure.mjs', 'packages', '--strict'],
  ['verify-arch-guards.mjs', 'packages', '--strict'],
  ['verify-event-pairing.mjs', 'packages', '--strict'],
  ['verify-param-registry.mjs', 'packages', '--strict'],
  ['verify-bundle-rows.mjs', 'packages', '--strict'],
  ['verify-param-channel-parity.mjs', 'packages', '--strict'],
  ['verify-doc-facts.mjs', 'packages', '--strict', '--require-repo-docs'],
  ['verify-package-discovery.mjs', 'packages', '--strict'],
  ['verify-family-tool-names.mjs', 'packages', '--strict'],
  ['verify-client-tokens.mjs', 'packages', '--strict'],
  ['verify-skill-roots.mjs', 'packages', '--strict'],
  ['verify-gate-manifest.mjs', 'packages'],
  ['verify-profile-bundles.mjs', '--self-test'],
  ['verify-release-artifacts.mjs', '.github', '--strict'],
]

/** Group 2: the specs that encode the regressions this set exists for. */
const SPECS = [
  'packages/evolution/evolution-approval/tests/approval.spec.ts',
  'packages/evolution/evolution-approval/tests/routes.spec.ts',
  'packages/evolution/evolution-host/tests/bundle-mutual-exclusion.spec.ts',
]

/** Group 3: audit-side self-checks (outside this repository by construction). */
const AUDIT = ['_coverage-check.mjs', '_syscheck.mjs', '_syscheck2.mjs']

const argv = process.argv.slice(2)
const flag = (name) => { const index = argv.indexOf(name); return index < 0 ? null : (argv[index + 1] ?? null) }
const root = resolve(argv.find((arg) => !arg.startsWith('--') && !argv.includes(arg) === false ? false : !arg.startsWith('--')) ?? 'packages')
const repo = resolve(root, '..')
const upstream = flag('--upstream')
const auditDir = flag('--audit-dir')
const scriptsDir = join(root, 'scripts')
const failures = []
const notes = []

// Group 1
for (const [script, ...args] of GUARDS) {
  const file = join(scriptsDir, script)
  if (!existsSync(file)) { failures.push(script + ': missing under ' + scriptsDir); continue }
  try {
    execFileSync(process.execPath, [file, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const stderr = error !== null && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : String(error)
    const first = stderr.split('\n').map((line) => line.trim()).filter((line) => line !== '')[0] ?? 'exit ' + String(error.status)
    failures.push('guard ' + script + ': ' + first)
  }
}

// Group 2
const vitest = upstream === null ? null : join(resolve(upstream), 'node_modules', 'vitest', 'vitest.mjs')
if (vitest === null || !existsSync(vitest)) {
  console.log('verify-regression-set: specs NOT executed (no --upstream carrying node_modules/vitest) — pass --upstream <platform tree>')
} else {
  const present = SPECS.filter((spec) => existsSync(join(resolve(upstream), spec)))
  const missing = SPECS.filter((spec) => !present.includes(spec))
  for (const spec of missing) failures.push('spec ' + spec + ': not present under ' + upstream)
  if (present.length > 0) {
    try {
      execFileSync(process.execPath, [vitest, 'run', ...present, '--maxWorkers=1', '--testTimeout=30000'],
        { cwd: resolve(upstream), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      notes.push(present.length + ' spec file(s) passed through ' + vitest)
    } catch (error) {
      const stderr = error !== null && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : String(error)
      const tail = stderr.split('\n').filter((line) => line.trim() !== '').slice(-3).join(' | ')
      failures.push('specs failed: ' + tail)
    }
  }
}

// Group 3
if (auditDir === null) {
  console.log('verify-regression-set: audit self-checks NOT executed (no --audit-dir) — ' + AUDIT.join(', '))
} else {
  for (const script of AUDIT) {
    const file = join(resolve(auditDir), script)
    if (!existsSync(file)) { failures.push('audit ' + script + ': missing under ' + auditDir); continue }
    try {
      execFileSync(process.execPath, [file], { cwd: resolve(auditDir), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      const stdout = error !== null && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : ''
      failures.push('audit ' + script + ': ' + stdout.split('\n').filter((line) => line.trim() !== '').slice(-1)[0])
    }
  }
  if (failures.length === 0) notes.push(AUDIT.length + ' audit self-check(s) passed')
}

if (failures.length > 0) {
  console.error('verify-regression-set: ' + failures.length + ' failure(s)')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
console.log('verify-regression-set: OK — ' + GUARDS.length + ' guard(s)' + (notes.length > 0 ? '; ' + notes.join('; ') : ''))