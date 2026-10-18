#!/usr/bin/env node
/**
 * Generate evolution-core/src/platform-line.generated.ts from the ONE platform-line.json.
 * Usage: node packages/scripts/gen-platform-line.mjs [--check]
 * `--check` fails when the generated file differs byte-for-byte (CI gate).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPlatformLine, resolvePlatformLineRoot } from './lib-platform-line.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const EVOLUTION_ROOT = dirname(HERE)
const TARGET = join(EVOLUTION_ROOT, 'evolution-core', 'src', 'platform-line.generated.ts')
const root = resolvePlatformLineRoot(import.meta.url)
const platformLine = readPlatformLine(root)
const relativeJson = 'platform-line.json (repository root)'

const generated = [
  '// GENERATED FILE — do not edit. Source: ' + relativeJson + ' (generator: packages/scripts/gen-platform-line.mjs).',
  '// Regenerate with: node packages/scripts/gen-platform-line.mjs',
  '/** The frozen platform line this release targets (peers/engines/anchors derived from version+floor). */',
  'export const PLATFORM_LINE = ' + JSON.stringify(platformLine, null, 2) + ' as const',
  '',
].join('\n')

const check = process.argv.includes('--check')
if (check) {
  if (!existsSync(TARGET)) { console.error('gen-platform-line: missing ' + TARGET + ' (run the generator)'); process.exit(1) }
  if (readFileSync(TARGET, 'utf8') !== generated) { console.error('gen-platform-line: STALE — ' + TARGET + ' differs from platform-line.json'); process.exit(1) }
  console.log('gen-platform-line: OK — generated constants match platform-line.json')
} else {
  writeFileSync(TARGET, generated, 'utf8')
  console.log('gen-platform-line: wrote ' + TARGET)
}
