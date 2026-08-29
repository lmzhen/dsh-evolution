#!/usr/bin/env node
/**
 * N-7 purity: inject ONLY the evolution alias paths into an upstream
 * tsconfig.base.json instead of overlaying a mirror copy over the released
 * tree.
 *
 * The mirror's tsconfig.base.json equals the pinned development baseline's
 * base plus the evolution paths block (it serves the baseline validate job as
 * a straight copy). The released-upstream compat job must validate the
 * RELEASED tree as shipped — its own base may have drifted (newly added dsh-*
 * path entries) — so this script:
 *   1. preserves the upstream file byte-for-byte apart from one insertion;
 *   2. inserts exactly the `@deepseek-ai/dsh-evolution*`/`@lmzhen`/`zod`
 *      alias lines extracted from the mirror base (single source);
 *   3. fails loudly when the upstream file ALREADY declares one of those keys
 *      (the platform absorbed the row — adapt the evolution alias set code).
 *
 * Usage (CI overlay, from the upstream tree root):
 *   node packages/evolution/scripts/inject-evolution-paths.mjs \
 *     <target-tsconfig> <mirror-tsconfig>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , target, mirror] = process.argv
if (!target || !mirror) {
  console.error('usage: inject-evolution-paths.mjs <target-tsconfig> <mirror-tsconfig>')
  process.exit(1)
}

const EVOLUTION_KEY = /^\s*"(@deepseek-ai\/dsh-(evolution|memory|tool-memory|skill-usage|tool-skill-manage)[^"]*|zod|@lmzhen[^"]*)"\s*:/

const mirrorContent = readFileSync(mirror, 'utf8').replace(/^\uFEFF/, '')
const evolutionLines = mirrorContent
  .split(/\r?\n/)
  .filter(line => EVOLUTION_KEY.test(line))

if (evolutionLines.length === 0) {
  console.error(`inject-evolution-paths: no evolution alias lines found in ${mirror}`)
  process.exit(1)
}

let content = readFileSync(target, 'utf8')
const noBom = content.replace(/^\uFEFF/, '')

// Existing evolution keys in the UPSTREAM file mean the platform absorbed the
// row (or the mirror drifted) — fail loud instead of mounting a duplicate
// path key.
for (const line of noBom.split(/\r?\n/)) {
  if (EVOLUTION_KEY.test(line)) {
    console.error(`inject-evolution-paths: ${target} already declares an evolution alias line: ${line.trim()}`)
    console.error('inject-evolution-paths: the platform absorbed this row — adapt the alias set (N-7)')
    process.exit(1)
  }
}

const marker = '"paths": {'
const index = noBom.indexOf(marker)
if (index < 0) {
  console.error(`inject-evolution-paths: no "paths" block found in ${target}`)
  process.exit(1)
}

const injected = evolutionLines.map(line => `      ${line.trim()}`).join('\n')
const next = noBom.slice(0, index + marker.length) + '\n' + injected + '\n' + noBom.slice(index + marker.length)
writeFileSync(target, next)

console.log(`inject-evolution-paths: injected ${evolutionLines.length} evolution alias line(s) into ${target} (N-7)`)
