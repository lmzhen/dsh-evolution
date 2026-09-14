#!/usr/bin/env node
/**
 * G5 (0.3.78) doc single-source gate, on its own: the same pass rule N19 runs
 * inside verify-arch-guards.mjs, so a maintainer can ask "which document owns
 * this fact, and who is copying it?" without running the whole guard.
 *
 * Facts live in scripts/family-facts.json (one home document each, other
 * documents cite the home, machine owners re-derive the values). Correctness of
 * this .mjs is proven by the fixtures in
 * evolution-host/tests/guard-scripts.spec.ts (scripts are outside oxlint).
 *
 * 0.3.78: warn mode by default (the family wires a new gate in warn mode for one
 * release, matching verify-arch-guards / verify-declared-config). Pass --strict
 * to fail loud; --require-repo-docs fails when the flat-mirror root documents
 * are absent instead of reporting them as unverified.
 *
 * Usage (both layouts — dev packages/evolution/scripts, flat mirror packages/scripts):
 *   node <scripts-dir>/verify-doc-facts.mjs <evolution-root> [--strict] [--require-repo-docs]
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { docFactViolations, formatDocFacts } from './lib-doc-facts.mjs'

const argv = process.argv.slice(2)
const rootArg = argv.find(arg => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages/evolution')
const strict = argv.includes('--strict')
if (rootArg !== undefined && !existsSync(root)) {
  console.error(`verify-doc-facts: no such root ${root} — usage: node verify-doc-facts.mjs <evolution-root> [--strict] [--require-repo-docs]`)
  process.exit(2)
}
const unknown = argv.filter(arg => arg.startsWith('--') && !['--strict', '--require-repo-docs'].includes(arg))
if (unknown.length > 0) {
  console.error(`verify-doc-facts: unknown flag ${unknown.join(', ')} — usage: node verify-doc-facts.mjs <evolution-root> [--strict] [--require-repo-docs]`)
  process.exit(2)
}

const result = docFactViolations(root, { requireRepoDocs: argv.includes('--require-repo-docs') })
console.log(`verify-doc-facts: ${formatDocFacts(result, root)}`)
if (result.violations.length > 0) {
  const level = strict ? 'FAIL' : 'WARN'
  console.error(`verify-doc-facts: ${level} — ${result.violations.length} doc single-source violation(s):`)
  console.error(result.violations.join('\n'))
  console.error(`verify-doc-facts: fix by editing the ONE home document (${'scripts/family-facts.json'} names it) or by citing the home — never by copying the statement.`)
}
process.exit(result.violations.length > 0 && strict ? 1 : 0)
