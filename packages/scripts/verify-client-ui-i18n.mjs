#!/usr/bin/env node
/**
 * U-8 judge ③ (G5.9): the client halves' visible copy must come from a dictionary.
 *
 * Two rules, both cheap to state and hard to satisfy by accident:
 *   A. no STRING LITERAL may be rendered as an element child (third argument onwards, whatever the
 *      arity) unless it is declared below with a reason — the declared ones are punctuation and the
 *      platform's diff marks;
 *   B. no cross-face instruction (dsh web, /evolution …) may appear in a string literal. Comments are
 *      stripped first (keeping line numbers), so a historical note is not a hit.
 *
 * Usage: node packages/scripts/verify-client-ui-i18n.mjs [packages-root]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Literal children that are structural, not copy. Every entry needs a reason. */
const DECLARED_CHILDREN = new Map([
  ['- ', 'diff mark: the platform renders removed lines with this prefix'],
  ['+ ', 'diff mark: the platform renders added lines with this prefix'],
  ['（', 'punctuation wrapper around a field unit'],
  ['）', 'punctuation wrapper around a field unit'],
])

/** Cross-face instructions: a GUI reader may not be sent to another surface. */
const CROSS_FACE = ['dsh web', '/evolution ']
/**
 * Declared exemptions, by file basename. The W7 fallback row is the ONE deliberate cross-face hint:
 * when the connection carrier is absent (E-325) the panel renders the command-face fallback from the
 * generated `COMMAND_FALLBACKS` table instead of a bare HTTP failure — that table is the feature,
 * not copy, and it is machine-generated (gen-client-seam.mjs --check keeps it in sync).
 */
const CROSS_FACE_EXEMPT = new Map([
  ['fallbacks.generated.ts', 'W7/E-325 fallback row — the command face IS the degraded UI choice (generated data)'],
])

const NL = String.fromCharCode(10)
const lines = (text) => text.split(NL)

/** Strip comments but KEEP line numbers (a block comment becomes blanks, not nothing). */
import { stripComments as withoutComments } from './lib-source-text.mjs'

/** Split one call's arguments at TOP-level commas, ignoring nested braces and string contents. */
function topLevelArgs(text, start) {
  const args = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (quote !== '') {
      current += ch
      if (ch === quote && text[i - 1] !== '\\') quote = ''
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue }
    if (ch === '(' || ch === '{' || ch === '[') { depth += 1; current += ch; continue }
    if (ch === ')' || ch === '}' || ch === ']') {
      if (depth === 0) { args.push(current); return args }
      depth -= 1; current += ch; continue
    }
    if (ch === ',' && depth === 0) { args.push(current); current = ''; continue }
    current += ch
  }
  args.push(current)
  return args
}

/** Every string literal rendered as a child, with the offset of its call. */
function literalChildren(text) {
  const found = []
  const callRe = /createElement\(/g
  let call
  while ((call = callRe.exec(text)) !== null) {
    const args = topLevelArgs(text, call.index + 'createElement('.length)
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index].trim()
      const match = /^('([^']*)'|"([^"]*)")$/.exec(argument)
      if (match !== null) found.push({ literal: match[2] ?? match[3], at: call.index })
    }
  }
  return found
}

const root = process.argv[2] ?? 'packages'
const halves = ['evolution-ui/src/panels/settings', 'evolution-ui/src/panels/history/client']
const problems = []
let scanned = 0

const walk = (dir, visit) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, visit)
    else if (entry.name.endsWith('.ts')) visit(path)
  }
}

for (const half of halves) {
  const dir = join(root, half)
  try {
    walk(dir, (path) => {
      scanned += 1
      const text = withoutComments(readFileSync(path, 'utf8'))
      for (const hit of literalChildren(text)) {
        if (DECLARED_CHILDREN.has(hit.literal)) continue
        problems.push(path + ':' + lines(text.slice(0, hit.at)).length + ' renders an undeclared literal child ' + JSON.stringify(hit.literal))
      }
      lines(text).forEach((line, index) => {
        const exempt = CROSS_FACE_EXEMPT.get(path.split(/[\\/]/).pop() ?? '')
        for (const phrase of CROSS_FACE) {
          if (!exempt && line.includes(phrase)) problems.push(path + ':' + (index + 1) + ' carries the cross-face instruction ' + JSON.stringify(phrase))
        }
      })
    })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

// Rule C (translation readiness): every family locale namespace carries zh, en AND ja.
// A ja table may be a `{ ...en }` placeholder (parity by construction) until a translation
// pass replaces it with a literal; a literal must then keep the same key set as zh/en.
const dictionaryFiles = []
const walkDictionaries = (dir) => {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    // Test fixtures are historical snapshots, not shipped namespaces: the parity rule
    // governs what the bundle registers, so `tests/` stays out of this scan. Build/staging
    // copies (lib, dist, .release-staging) are the same sources again, not new namespaces.
    const skipped = new Set(['tests', 'lib', 'dist', 'node_modules', '.release-staging'])
    if (entry.isDirectory()) { if (!skipped.has(entry.name)) walkDictionaries(path) }
    // `<pkg>/src/messages.ts` is the HOST catalog (tool results / errors); the client
    // namespaces live in a panel/client subdirectory. Different registry, different gate.
    else if (entry.name === 'messages.ts' && entry.name && dir.split(/[\\/]/).pop() !== 'src') dictionaryFiles.push(path)
  }
}
walkDictionaries(root)

/** The body of the object literal opened after `marker`, braces excluded. */
function objectBody(text, marker) {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const start = text.indexOf('{', at + marker.length)
  if (start < 0) return null
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start + 1, index)
    }
  }
  return null
}

/** The keys declared at the object body's own two-space level. */
function dictionaryKeys(body) {
  const keys = new Set()
  for (const line of body.split(NL)) {
    const match = /^\s{2}'?([A-Za-z0-9_.-]+)'?\s*:/.exec(line)
    if (match !== null) keys.add(match[1])
  }
  return keys
}

/** One dictionary's key → single-quoted value pairs (the family's flat copy tables). */
function dictionaryEntries(body) {
  const entries = new Map()
  for (const line of body.split(NL)) {
    const match = /^\s{2}'?([A-Za-z0-9_.-]+)'?\s*:\s*'((?:[^'\\]|\\.)*)'/.exec(line)
    if (match !== null) entries.set(match[1], match[2])
  }
  return entries
}

/** Keys a dictionary gains through `Object.assign(<name>, { ... })` after its literal. */
function assignedKeys(text, name) {
  const keys = new Set()
  const pattern = new RegExp('Object\\.assign\\(\\s*' + name + '\\s*,\\s*\\{([\\s\\S]*?)\\}\\)', 'g')
  let match
  while ((match = pattern.exec(text)) !== null) {
    for (const key of dictionaryKeys(match[1])) keys.add(key)
  }
  return keys
}

let placeholderDictionaries = 0
let untranslatedValues = 0
for (const path of dictionaryFiles) {
  const text = withoutComments(readFileSync(path, 'utf8'))
  const zhBody = objectBody(text, 'export const zh')
  const enBody = objectBody(text, 'export const en')
  const jaBody = objectBody(text, 'export const ja')
  if (zhBody === null || enBody === null) {
    problems.push(path + ' does not export both zh and en dictionaries')
    continue
  }
  if (jaBody === null) {
    problems.push(path + ' has no ja dictionary — add one (a `{ ...en }` placeholder is accepted) so the namespace is translation-ready')
    continue
  }
  const zhKeys = dictionaryKeys(zhBody)
  const enKeys = dictionaryKeys(enBody)
  for (const key of assignedKeys(text, 'zh')) zhKeys.add(key)
  for (const key of assignedKeys(text, 'en')) enKeys.add(key)
  for (const key of assignedKeys(text, 'ja')) jaKeys.add(key)
  for (const key of zhKeys) if (!enKeys.has(key)) problems.push(path + ': en is missing key ' + JSON.stringify(key))
  for (const key of enKeys) if (!zhKeys.has(key)) problems.push(path + ': zh is missing key ' + JSON.stringify(key))
  if (/^\s*\.\.\.en\s*,?\s*$/m.test(jaBody)) {
    placeholderDictionaries += 1
    continue
  }
  const jaKeys = dictionaryKeys(jaBody)
  for (const key of zhKeys) if (!jaKeys.has(key)) problems.push(path + ': ja is missing key ' + JSON.stringify(key))
  for (const key of jaKeys) if (!zhKeys.has(key)) problems.push(path + ': ja carries key ' + JSON.stringify(key) + ' that zh does not declare')
  // Translation progress, not a failure: a ja value still identical to its en twin (when zh differs) is untranslated.
  const zhEntries = dictionaryEntries(zhBody)
  const enEntries = dictionaryEntries(enBody)
  const assignPattern = /Object\.assign\(\s*en\s*,\s*\{([\s\S]*?)\}\)/g
  let assignMatch
  while ((assignMatch = assignPattern.exec(text)) !== null) {
    for (const [key, value] of dictionaryEntries(assignMatch[1])) enEntries.set(key, value)
  }
  const jaEntries = dictionaryEntries(jaBody)
  for (const [key, value] of jaEntries) if (enEntries.get(key) === value && zhEntries.get(key) !== value) untranslatedValues += 1
}

if (problems.length > 0) {
  console.error('verify-client-ui-i18n: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-client-ui-i18n: OK — ' + scanned + ' client source file(s), no undeclared copy; '
  + dictionaryFiles.length + ' locale namespace(s) carry zh/en/ja ('
  + placeholderDictionaries + ' ja placeholder(s), ' + untranslatedValues + ' untranslated value(s))')
