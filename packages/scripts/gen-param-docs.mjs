#!/usr/bin/env node
/**
 * Generate packages/docs/parameters.md from the parameter registry (G1/S1.2).
 *
 * The registry is the single source; this document is a build product, so a
 * hand edit is drift by definition and verify-param-registry.mjs reports it.
 * Deterministic: the same registry always renders the same bytes, which is what
 * makes '--check' a useful gate.
 *
 * Usage: node gen-param-docs.mjs <evolution-root> [--check]
 *   --check  verify the document is current instead of writing it
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { docsPath, readRegistry, registryViolations, renderParamDocs } from './lib-param-registry.mjs'

const argv = process.argv.slice(2)
const rootArg = argv.find(arg => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages')
const check = argv.includes('--check')
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--check')
if (unknown.length > 0) {
  console.error('gen-param-docs: unknown flag ' + unknown.join(', ') + ' — usage: node gen-param-docs.mjs <evolution-root> [--check]')
  process.exit(2)
}

let registry
try {
  registry = readRegistry(root)
} catch (error) {
  console.error('gen-param-docs: cannot read the registry under ' + root + ' — ' + String(error.message))
  process.exit(2)
}
const violations = registryViolations(registry, root)
const document = renderParamDocs(registry, violations)
const target = docsPath(root)
const previous = existsSync(target) ? readFileSync(target, 'utf8') : null
const summary = registry.entries.length + ' entries, ' + violations.notes.length + ' canonical id(s) pending'

if (previous === document) {
  console.log('gen-param-docs: up to date — ' + summary)
  process.exit(0)
}
if (check) {
  console.error('gen-param-docs: STALE — ' + target + ' differs from the registry (' + summary + '); rerun without --check')
  process.exit(1)
}
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, document, 'utf8')
console.log('gen-param-docs: wrote ' + target + ' (' + summary + ')')
