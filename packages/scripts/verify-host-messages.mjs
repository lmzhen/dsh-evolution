#!/usr/bin/env node
/**
 * Host-message i18n gate: tool-result and error copy must be translatable.
 *
 * The client half has `verify-client-ui-i18n.mjs`; the host half produces tool results
 * and error prose, and those strings are the ones a model and a reader see. This gate
 * enforces three rules for every package listed in `scripts/host-messages.json`:
 *
 *   A. the package owns a `src/messages.ts` table and registers it
 *      (`registerHostMessages(...)`), with identical `en` / `ja` key sets;
 *   B. every `tr('…')` call's source string is declared in that table (the source IS
 *      the key — gettext shape), so a new message cannot ship untranslatable;
 *   C. no bare CJK string literal remains outside `messages.ts` (comments are stripped),
 *      except files listed under the package's `allow` list — prompts and registry UI
 *      copy are not tool results.
 *
 * A translation value is `''` until a translator fills it; the count is printed as
 * progress, never as a failure.
 *
 * Usage: node packages/scripts/verify-host-messages.mjs [packages-root] [--package <name>]
 * The optional `--package` limits the run to one package (a teammate's self-check).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stripComments } from './lib-source-text.mjs'

const argv = process.argv.slice(2)
const rootArg = argv.find(arg => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages')
const packageIndex = argv.indexOf('--package')
const only = packageIndex >= 0 ? argv[packageIndex + 1] : undefined
const NL = String.fromCharCode(10)
const CJK = /[\u4e00-\u9fff]/

const manifestPath = join(root, 'scripts', 'host-messages.json')
if (!existsSync(manifestPath)) {
  console.error('verify-host-messages: missing ' + manifestPath)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const packages = (manifest.packages ?? []).filter(name => only === undefined || name === only)
if (only !== undefined && packages.length === 0) {
  console.error('verify-host-messages: package ' + only + ' is not in ' + manifestPath)
  process.exit(2)
}

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

/** `{ key: value }` pairs at the table's own two-space level (single-quoted strings). */
function tableEntries(body) {
  const entries = new Map()
  for (const line of body.split(NL)) {
    const match = /^\s{2}'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'?/.exec(line)
    if (match !== null) entries.set(match[1], match[2])
  }
  return entries
}

/** Every `tr(…)` source string in one file (single/double quotes or a plain template). */
function trSources(text) {
  const found = []
  for (const match of text.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'|\btr\(\s*"((?:[^"\\]|\\.)*)"|\btr\(\s*`((?:[^`\\]|\\.)*)`/g)) {
    found.push(match[1] ?? match[2] ?? match[3])
  }
  return found
}

/**
 * Bare CJK literals left in one file (single/double/backtick), with line numbers.
 * A line carrying `i18n-allow` opts out: some Chinese strings are DATA (a stored enum
 * value, a matching key), not copy, and wrapping them would change behavior.
 * @param text - the file text.
 * @param raw - the same file before comment stripping (the marker lives in a comment).
 * @returns the offending literals.
 */
function cjkLiterals(text, raw) {
  const found = []
  const lines = text.split(NL)
  const rawLines = raw.split(NL)
  // A `tr('中文源串')` first argument IS the catalog key, not bare copy: collect the
  // absolute offsets it occupies and skip literals starting inside them. stripComments
  // blanks comments in place, so offsets in `text` and `raw` agree.
  const allowed = []
  for (const match of text.matchAll(/\btr\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g)) {
    allowed.push([match.index, match.index + match[0].length])
  }
  let base = 0
  lines.forEach((line, index) => {
    const lineStart = base
    base += line.length + 1
    if ((rawLines[index] ?? '').includes('i18n-allow')) return
    for (const match of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      if (!CJK.test(match[0])) continue
      const at = lineStart + match.index
      if (allowed.some(([start, end]) => at >= start && at < end)) continue
      found.push({ line: index + 1, text: match[0].slice(0, 60) })
    }
  })
  return found
}

/** Recursively collect `.ts` files under one directory, skipping tests/client/build output. */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['tests', 'client', 'lib', 'dist', 'node_modules'].includes(entry.name)) continue
      sourceFiles(join(dir, entry.name), out)
    } else if (entry.name.endsWith('.ts')) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

const problems = []
let keys = 0
let translated = 0
for (const name of packages) {
  const srcDir = join(root, name, 'src')
  const tablePath = join(srcDir, 'messages.ts')
  if (!existsSync(tablePath)) {
    problems.push(name + ': no src/messages.ts table — the package still ships hard-coded host copy')
    continue
  }
  const tableText = readFileSync(tablePath, 'utf8')
  if (!tableText.includes('registerHostMessages(')) {
    problems.push(name + ': src/messages.ts does not call registerHostMessages(...)')
  }
  const enBody = objectBody(tableText, 'en:')
  const jaBody = objectBody(tableText, 'ja:')
  if (enBody === null || jaBody === null) {
    problems.push(name + ': src/messages.ts does not carry both en and ja columns')
    continue
  }
  const en = tableEntries(enBody)
  const ja = tableEntries(jaBody)
  for (const key of en.keys()) if (!ja.has(key)) problems.push(name + ': ja is missing key ' + JSON.stringify(key.slice(0, 50)))
  for (const key of ja.keys()) if (!en.has(key)) problems.push(name + ': en is missing key ' + JSON.stringify(key.slice(0, 50)))
  keys += en.size
  // A translation that drops or renames a `{slot}` silently loses the interpolated value.
  const slotsOf = (value) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',')
  for (const [column, table] of [['en', en], ['ja', ja]]) {
    for (const [key, value] of table) {
      if (value === '') continue
      const source = slotsOf(key)
      const translated = slotsOf(value)
      if (source !== translated) {
        problems.push(name + ': ' + column + ' placeholder drift for ' + JSON.stringify(key.slice(0, 50)) + ' — source [' + source + '] vs ' + column + ' [' + translated + ']')
      }
    }
  }
  // The central error catalog carries its own columns (`%aN%` slots); check it with the
  // same discipline when the package owns it.
  const errorsPath = join(srcDir, 'errors.ts')
  if (existsSync(errorsPath)) {
    const errorsText = readFileSync(errorsPath, 'utf8')
    const columns = {
      zh: objectBody(errorsText, 'EVOLUTION_ERRORS = Object.freeze('),
      en: objectBody(errorsText, 'EVOLUTION_ERRORS_EN'),
      ja: objectBody(errorsText, 'EVOLUTION_ERRORS_JA'),
    }
    if (columns.zh === null || columns.en === null || columns.ja === null) {
      problems.push(name + ': errors.ts must carry EVOLUTION_ERRORS, _EN and _JA columns')
    } else {
      const pct = (value) => [...value.matchAll(/%a(\d+)%/g)].map(match => match[1]).sort().join(',')
      const zhTable = tableEntries(columns.zh)
      for (const [column, body] of [['en', columns.en], ['ja', columns.ja]]) {
        const table = tableEntries(body)
        for (const [id, value] of zhTable) {
          const translated = table.get(id)
          if (typeof translated !== 'string' || translated === '') {
            problems.push(name + ': errors.ts ' + column + ' is missing ' + id)
            continue
          }
          if (pct(value) !== pct(translated)) {
            problems.push(name + ': errors.ts ' + column + ' placeholder drift for ' + id + ' — zh [' + pct(value) + '] vs ' + column + ' [' + pct(translated) + ']')
          }
        }
        for (const id of table.keys()) if (!zhTable.has(id)) problems.push(name + ': errors.ts ' + column + ' carries unknown ' + id)
      }
    }
  }
  for (const value of en.values()) if (value !== '') translated += 1
  for (const value of ja.values()) if (value !== '') translated += 1

  const allow = new Set(manifest.allow?.[name] ?? [])
  for (const path of sourceFiles(srcDir)) {
    if (path === tablePath) continue
    for (const source of trSources(readFileSync(path, 'utf8'))) {
      if (!en.has(source)) {
        problems.push(path.slice(root.length + 1) + ': tr() source is not declared in ' + name + '/src/messages.ts: ' + JSON.stringify(source.slice(0, 60)))
      }
    }
    if (allow.has(path.split(/[\\/]/).pop())) continue
    const rawText = readFileSync(path, 'utf8')
    const literals = cjkLiterals(stripComments(rawText), rawText)
    for (const hit of literals) {
      problems.push(path.slice(root.length + 1) + ':' + hit.line + ': bare CJK literal outside the catalog: ' + hit.text)
    }
  }
}

if (problems.length > 0) {
  console.error('verify-host-messages: ' + problems.length + ' problem(s)')
  for (const problem of problems.slice(0, 80)) console.error('  ' + problem)
  if (problems.length > 80) console.error('  … ' + (problems.length - 80) + ' more')
  process.exit(1)
}
console.log('verify-host-messages: OK — ' + packages.length + ' package(s), ' + keys + ' message key(s), '
  + translated + ' translated value(s)')
