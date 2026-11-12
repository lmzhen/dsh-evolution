#!/usr/bin/env node
/**
 * inject-evolution-paths.mjs — write the family alias block into an upstream tsconfig.
 *
 * Usage (CI overlay, from the upstream tree root):
 *   node packages/evolution/scripts/inject-evolution-paths.mjs <target-tsconfig> [mirror-tsconfig]
 *
 * The alias set is DERIVED from the family packages present in the checkout
 * (`packages/evolution/<dir>/package.json` `exports`), not copied from a mirror file: after the
 * G8 merges the mirror base still named deleted packages and knew nothing about the new subpath
 * exports (`state/storage`, `memory/files`, `activity/feedback`, ...), so copying it produced a
 * base where CI could neither resolve a merged subpath nor trust the stale keys.
 *
 * Every export target of the form `./lib/<x>.js` / `./lib/<x>/index.js` maps to the package's
 * source file `src/<x>.ts` / `src/<x>/index.ts`; aliases whose source is absent are dropped. The
 * optional second argument is a mirror base that must agree with the derived set; it is only a
 * cross-check, never the source.
 */
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [, , target, mirrorArg] = process.argv
if (!target) {
  console.error('usage: inject-evolution-paths.mjs <target-tsconfig> [mirror-tsconfig]')
  process.exit(1)
}

const targetPath = resolve(target)
const root = resolve(targetPath, '..')
const familyRoot = join(root, 'packages', 'evolution')
if (!existsSync(familyRoot)) {
  console.error('inject-evolution-paths: no packages/evolution tree under ' + root)
  process.exit(1)
}

function sourceFor(dir, exportTarget) {
  const bare = exportTarget.replace(/^\.\//, '')
  if (!bare.startsWith('lib/')) return null
  const rel = bare.slice('lib/'.length).replace(/\.js$/, '').replace(/\/index$/, '')
  const candidates = [join(dir, 'src', rel + '.ts'), join(dir, 'src', rel, 'index.ts'), join(dir, 'src', rel + '.tsx')]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const aliases = new Map()
for (const dirName of readdirSync(familyRoot)) {
  const dir = join(familyRoot, dirName)
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) continue
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { continue }
  if (typeof manifest.name !== 'string') continue
  const exportsField = manifest.exports
  if (exportsField === undefined) continue
  const entries = typeof exportsField === 'string' ? [['.', exportsField]] : Object.entries(exportsField)
  for (const [key, value] of entries) {
    const exportTarget = typeof value === 'string' ? value : value?.default
    if (typeof exportTarget !== 'string' || !exportTarget.startsWith('./')) continue
    const source = sourceFor(dir, exportTarget)
    if (source === null) continue
    const specifier = key === '.' ? manifest.name : manifest.name + key.slice(1)
    aliases.set(specifier, './' + source.slice(root.length + 1).replace(/\\/g, '/'))
  }
}
if (aliases.size === 0) {
  console.error('inject-evolution-paths: no family export alias could be derived under ' + familyRoot)
  process.exit(1)
}

const content = readFileSync(targetPath, 'utf8')
const hasBom = content.startsWith('\uFEFF')
const eol = content.includes('\r\n') ? '\r\n' : '\n'
const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)

const FAMILY_KEY = /^\s*"(@deepseek-ai\/(dsh-evolution|dsh-memory|dsh-tool-memory|dsh-skill-usage|dsh-tool-skill-manage)[^"]*|@lmzhen[^"]*)"\s*:/
for (const line of lines) {
  if (FAMILY_KEY.test(line)) {
    console.error('inject-evolution-paths: ' + target + ' already declares a family alias line: ' + line.trim())
    console.error('inject-evolution-paths: the platform absorbed this row — adapt the alias set (N-7)')
    process.exit(1)
  }
}

const start = lines.findIndex((line) => /^\s*"paths"\s*:\s*\{/.test(line))
if (start < 0) {
  console.error('inject-evolution-paths: no "paths" block found in ' + target)
  process.exit(1)
}
let depth = 0
let end = -1
for (let index = start; index < lines.length; index += 1) {
  for (const char of lines[index]) {
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
  }
  if (depth === 0 && index > start) { end = index; break }
}
if (end < 0) {
  console.error('inject-evolution-paths: could not find the end of the paths block in ' + target)
  process.exit(1)
}
// The released base maps most platform packages to a SYMBOL directory (e.g. `./vendor/cordis/src`).
// Vite 8 resolves such a directory through the package manifest instead of trying `index.ts`,
// so a platform package whose main is the not-yet-built `lib/index.js` fails ("Failed to resolve
// entry for package ..."). Pinning the same mapping to the directory's `index.ts` is an equivalent
// resolution (the file TypeScript itself picks) for the test plane only.
const PINNED_INDEX = /^\s*"([^"]+)"\s*:\s*\[\s*"(\.\/[^"]+)"\s*\],?\s*$/
const pinIndex = (line) => {
  const match = PINNED_INDEX.exec(line)
  if (match === null) return line
  const dir = join(root, match[2])
  if (existsSync(join(dir, 'package.json'))) return line
  if (existsSync(join(dir, 'index.ts'))) return line.replace('"' + match[2] + '"', '"' + match[2] + '/index.ts"')
  return line
}

// Keep comments and platform entries untouched; only the LAST entry before our block needs a
// comma, and every inserted entry carries one (the closing brace follows the block).
const inner = lines.slice(start + 1, end).map(pinIndex)
const lastEntry = [...inner].reverse().find((line) => /^\s*"([^"]+)"\s*:/.test(line))
const innerFixed = inner.map((line) => {
  if (line !== lastEntry) return line
  return /,\s*$/.test(line) ? line : line.replace(/\s*$/, ',')
})

const block = [...aliases.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([specifier, source]) => `      "${specifier}": ["${source}"],`)
const rebuilt = [...lines.slice(0, start + 1), ...innerFixed, ...block, ...lines.slice(end)]
writeFileSync(targetPath + '.tmp', (hasBom ? '\uFEFF' : '') + rebuilt.join(eol))
renameSync(targetPath + '.tmp', targetPath)

if (mirrorArg !== undefined) {
  const derived = [...aliases.keys()].sort().join('\n')
  const mirrorKeys = [...readFileSync(resolve(mirrorArg), 'utf8').matchAll(/^\s*"(@deepseek-ai\/(?:dsh-evolution|dsh-memory|dsh-tool-memory|dsh-skill-usage|dsh-tool-skill-manage)[^"]*|@lmzhen[^"]*)"\s*:/gm)].map((match) => match[1]).sort().join('\n')
  if (mirrorKeys !== derived) {
    console.warn('inject-evolution-paths: the mirror base alias set differs from the derived set; the derived set is authoritative')
  }
}
console.log('inject-evolution-paths: wrote ' + aliases.size + ' family alias(es) into ' + target)
