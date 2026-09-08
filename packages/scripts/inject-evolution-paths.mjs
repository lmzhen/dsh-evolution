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
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

const [, , target, mirror] = process.argv
if (!target || !mirror) {
  console.error('usage: inject-evolution-paths.mjs <target-tsconfig> <mirror-tsconfig>')
  process.exit(1)
}

// `zod` is deliberately NOT in the evolution alias set (G5.6, F-345/F-353):
// it is not an `@deepseek-ai/dsh-*` package, its dev-tree path value is a
// machine-specific pnpm store path (`./node_modules/.pnpm/zod@4.4.3/...`),
// and the released upstream resolves zod from its own node_modules. Injecting
// that store path both breaks when the upstream's pnpm store differs and
// trips the "already declares an evolution alias" guard the moment the
// upstream carries its own `zod` key — so exclude it from the injection set.
const EVOLUTION_KEY = /^\s*"(@deepseek-ai\/dsh-(evolution|memory|tool-memory|skill-usage|tool-skill-manage)[^"]*|@lmzhen[^"]*)"\s*:/

const mirrorContent = readFileSync(mirror, 'utf8').replace(/^\uFEFF/, '')
const evolutionLines = mirrorContent
  .split(/\r?\n/)
  .filter(line => EVOLUTION_KEY.test(line))

if (evolutionLines.length === 0) {
  console.error(`inject-evolution-paths: no evolution alias lines found in ${mirror}`)
  process.exit(1)
}

let content = readFileSync(target, 'utf8')
// Preserve the target's byte-level conventions (F-352): keep its BOM and reuse
// its line ending so the single inserted block does not leave mixed EOLs.
const hasBom = content.startsWith('\uFEFF')
const eol = content.includes('\r\n') ? '\r\n' : '\n'
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

const injected = evolutionLines.map(line => `      ${line.trim()}`).join(eol)
const next = noBom.slice(0, index + marker.length) + eol + injected + eol + noBom.slice(index + marker.length)

// R-04: smoke-parse the composed JSONC BEFORE writing. The insertion
// silently assumed every injected line carries a trailing comma — an alias
// that is the LAST entry of the mirror's paths block would land mid-block
// without one and produce invalid JSONC. Strip comments (string-aware) and
// trailing commas, then JSON.parse; any failure is loud and leaves the target
// untouched.
function jsoncParse(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i += 1
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
    } else {
      out += ch
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}
try {
  jsoncParse(next)
} catch (error) {
  console.error(`inject-evolution-paths: composed ${target} is not valid JSONC after injection (${error instanceof Error ? error.message : String(error)})`)
  console.error('inject-evolution-paths: an injected alias line is likely missing a trailing comma — fix the mirror base instead of shipping a broken tsconfig')
  process.exit(1)
}

// Atomic write (F-352): write a sibling temp and rename so a crash never
// leaves a half-written tsconfig, and re-attach the original BOM.
const tmp = `${target}.tmp`
writeFileSync(tmp, (hasBom ? '\uFEFF' : '') + next)
renameSync(tmp, target)

console.log(`inject-evolution-paths: injected ${evolutionLines.length} evolution alias line(s) into ${target} (N-7); composed JSONC smoke-parsed OK`)
