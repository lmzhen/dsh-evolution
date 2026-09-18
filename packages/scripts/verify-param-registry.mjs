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
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

// The client view is generated from the SAME text and carries the per-field UI
// metadata (label, hint, control, unit, values). Nothing else in the gate compares
// it — the parity guard checks the field-id SET only — so a registry edit that
// changes a unit, an enum domain or a control kind would ship stale metadata to the
// browser while every step stayed green. The generator owns the formatting, so this
// runs IT with --check instead of re-rendering the file here.
const generator = join(dirname(fileURLToPath(import.meta.url)), 'gen-param-client-view.mjs')
try {
  execFileSync(process.execPath, [generator, root, '--check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) {
  const detail = String(error.stderr ?? error.stdout ?? error.message).trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 200)
  problems.push('stale generated client view (run gen-param-client-view.mjs): ' + detail)
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
