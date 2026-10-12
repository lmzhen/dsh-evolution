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
const halves = ['evolution-settings-ui/src/client', 'evolution-skill-history/src/client']
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
        for (const phrase of CROSS_FACE) {
          if (line.includes(phrase)) problems.push(path + ':' + (index + 1) + ' carries the cross-face instruction ' + JSON.stringify(phrase))
        }
      })
    })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

if (problems.length > 0) {
  console.error('verify-client-ui-i18n: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-client-ui-i18n: OK — ' + scanned + ' client source file(s), no undeclared copy')
