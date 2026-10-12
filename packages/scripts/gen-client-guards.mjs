#!/usr/bin/env node
/**
 * G7.1 (audit A8): the plain-object predicate reaches the CLIENT halves through a generated copy.
 *
 * The client bundles cannot import core — packages/scripts/build-client.mjs:77 externalizes every
 * @deepseek-ai/* specifier — so a shared pure function has to be SOURCED from the host module and
 * emitted into each half. This is that emitter: evolution-core/src/guards.ts is the one author, and
 * the two client copies are derived from it. --check fails on a hand edit.
 *
 * Usage: node packages/scripts/gen-client-guards.mjs <evolution-root> [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const rootArg = argv.find((arg) => !arg.startsWith('--')) ?? 'packages'
const check = argv.includes('--check')
const unknown = argv.filter((arg) => arg.startsWith('--') && arg !== '--check')
if (unknown.length > 0) {
  console.error('gen-client-guards: unknown flag ' + unknown.join(', ') + ' - usage: node gen-client-guards.mjs <evolution-root> [--check]')
  process.exit(2)
}

const SOURCE = join(rootArg, 'evolution-core/src/guards.ts')
const TARGETS = [
  join(rootArg, 'evolution-settings-ui/src/client/guards.ts'),
  join(rootArg, 'evolution-skill-history/src/client/guards.ts'),
]
const NL = String.fromCharCode(10)
const source = readFileSync(SOURCE, 'utf8')
const stripped = source
  .replace(/^\/\*\*[\s\S]*?\*\//, '')
  .replace(/^import .*$/gm, '')
  .trim()
const body = [
  '// GENERATED FILE -- do not edit. Source: evolution-core/src/guards.ts',
  '// Regenerate with: node packages/scripts/gen-client-guards.mjs <evolution-root>',
  '// (G7.1/A8: the client bundles externalize @deepseek-ai/*, so the shared predicate is EMITTED here.)',
  '',
  stripped,
  '',
].join(NL)

let stale = 0
for (const target of TARGETS) {
  let current = null
  try { current = readFileSync(target, 'utf8') } catch { current = null }
  if (check) {
    if (current !== body) { console.error('gen-client-guards: ' + target + ' is STALE (rerun without --check)'); stale += 1 }
    continue
  }
  writeFileSync(target, body)
  console.log('gen-client-guards: wrote ' + target)
}
if (check) {
  if (stale > 0) process.exit(1)
  console.log('gen-client-guards: OK — ' + TARGETS.length + ' client copies match ' + SOURCE)
}
