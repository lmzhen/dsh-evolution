#!/usr/bin/env node
/**
 * Parameter-registry guard (G1/S1.3, gate step after verify-declared-config).
 *
 * Two mechanical questions: does the registry satisfy its contract (design
 * 8.1), and is packages/PARAMETERS.md current with respect to it? Both are
 * answered from the SAME text the runtime module uses (machine-read contract in
 * params.ts), and param-registry.spec.ts pins text-versus-module agreement.
 *
 * Warn mode by default, --strict fails loud (family convention for a gate's
 * first releases); the family gate runs it with --strict.
 *
 * Usage: node verify-param-registry.mjs <evolution-root> [--strict]
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { docsPath, readRegistry, registryViolations, renderParamDocs } from './lib-param-registry.mjs'

const argv = process.argv.slice(2)
const rootArg = argv.find(arg => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages')
const strict = argv.includes('--strict')
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--strict')
if (unknown.length > 0) {
  console.error('verify-param-registry: unknown flag ' + unknown.join(', ') + ' — usage: node verify-param-registry.mjs <evolution-root> [--strict]')
  process.exit(2)
}

let registry
try {
  registry = readRegistry(root)
} catch (error) {
  console.error('verify-param-registry: FAIL — no registry under ' + root + ' (' + String(error.message) + ')')
  process.exit(1)
}

const problems = []
const check = registryViolations(registry, root)
problems.push(...check.violations)

const target = docsPath(root)
if (!existsSync(target)) problems.push('missing generated document ' + target + ' (run gen-param-docs.mjs)')
else {
  const expected = renderParamDocs(registry, check)
  const actual = readFileSync(target, 'utf8')
  if (actual !== expected) problems.push('stale generated document ' + target + ' (run gen-param-docs.mjs)')
}

const groups = new Set(registry.entries.map(entry => entry.group)).size
const summary = registry.entries.length + ' entries, ' + groups + ' group(s), ' + check.notes.length + ' canonical id(s) pending'
if (problems.length === 0) {
  console.log('verify-param-registry: OK — ' + summary)
  process.exit(0)
}
const level = strict ? 'FAIL' : 'WARN'
console.error('verify-param-registry: ' + level + ' — ' + problems.length + ' problem(s):')
for (const problem of problems) console.error('  - ' + problem)
console.error('verify-param-registry: fix the registry in evolution-core/src/params.ts, then rerun gen-param-docs.mjs')
process.exit(strict ? 1 : 0)
