#!/usr/bin/env node
/**
 * G6.1 (M1): the preset composer has ONE author — this port is DERIVED, never hand-edited.
 *
 * Fourteen functions of the user-root composer existed twice: once in
 * evolution-core/src/preset-composition.ts (the plugin side) and once inside
 * packages/scripts/install-layered.mjs (the source installer). The installer cannot import the TS
 * module — it runs on the operator's Node (floor 22.19+ per INSTALL.md), where a .ts import is not
 * guaranteed — so the single-author rule is kept by generating a plain-JS port from the TS source
 * and gating it with --check: hand-editing the port fails the gate.
 *
 * Type stripping uses the platform's own module.stripTypeScriptTypes(), so the port is mechanical
 * (no hand-maintained copy of the signatures). The one relative import (./env.ts) is inlined.
 *
 * Usage: node packages/scripts/gen-composer-port.mjs <evolution-root> [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'

const argv = process.argv.slice(2)
const rootArg = argv.find((arg) => !arg.startsWith('--')) ?? 'packages'
const check = argv.includes('--check')
const unknown = argv.filter((arg) => arg.startsWith('--') && arg !== '--check')
if (unknown.length > 0) {
  console.error('gen-composer-port: unknown flag ' + unknown.join(', ') + ' - usage: node gen-composer-port.mjs <evolution-root> [--check]')
  process.exit(2)
}

const coreDir = join(rootArg, 'evolution-core/src')
const target = join(rootArg, 'scripts/lib-preset-composition.mjs')

const strip = (source) => stripTypeScriptTypes(source, { mode: 'strip' })

const envSource = strip(readFileSync(join(coreDir, 'env.ts'), 'utf8'))
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')
  .trim()

/**
 * The composer source, with its single relative import satisfied in place.
 *
 * G6.1/M1 — the ONE location-dependent rewrite: the override table is resolved module-relatively,
 * so the port must look for it from ITS own directory. The port lives in `scripts/`, and
 * `../evolution-core/row-overrides.json` is the same real file core reads from `src/` — asserted
 * below so a moved table fails the generator instead of failing an install.
 */
const ROW_OVERRIDES_ANCHOR = "const ROW_OVERRIDES_URL = new URL('../row-overrides.json', import.meta.url)"
const PORT_ROW_OVERRIDES = "const ROW_OVERRIDES_URL = new URL('../evolution-core/row-overrides.json', import.meta.url) // PORT PATH: this file lives in scripts/"
const stripped = strip(readFileSync(join(coreDir, 'preset-composition.ts'), 'utf8'))
  .replace(/^import \{ allowRowCollisions \} from '\.\/env\.ts'$/m, '')
  .replace(/^import .*? from 'node:.*'$/gm, (line) => line)
if (stripped.split(ROW_OVERRIDES_ANCHOR).length !== 2) {
  console.error('gen-composer-port: the row-overrides anchor moved in preset-composition.ts — re-point the rewrite')
  process.exit(1)
}
const composer = stripped.replace(ROW_OVERRIDES_ANCHOR, PORT_ROW_OVERRIDES)

const body = [
  '// GENERATED FILE — do not edit. Source: evolution-core/src/preset-composition.ts',
  '// Regenerate with: node packages/scripts/gen-composer-port.mjs <evolution-root>',
  '// (G6.1/M1: the installer imports this port so the composer has ONE author.)',
  '',
  '// Inlined from evolution-core/src/env.ts by the generator (the port carries no relative imports).',
  envSource,
  '',
  composer.trim(),
  '',
].join(String.fromCharCode(10))

if (check) {
  let current = null
  try { current = readFileSync(target, 'utf8') } catch { current = null }
  if (current !== body) {
    console.error('gen-composer-port: the port is STALE (rerun without --check)')
    process.exit(1)
  }
  const exported = [...body.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((m) => m[1])
  console.log('gen-composer-port: OK — port matches its source (' + exported.length + ' exported function(s))')
  process.exit(0)
}

writeFileSync(target, body)
console.log('gen-composer-port: wrote ' + target)
