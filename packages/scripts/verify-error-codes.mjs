#!/usr/bin/env node
/**
 * G4.3 (C5): the error-code table and its documentation must be the SAME SET.
 *
 * The codes live once, in package sources ("THE error-code table"); README carries the operator-facing
 * table. Two drifts are possible and this gate catches both: a code added to the source but not
 * documented, and a row documenting a code that no longer exists. It also checks the RANGE the docs
 * state, which is the classic hand-written number nobody updates.
 *
 * Usage: node packages/scripts/verify-error-codes.mjs [packages-root]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'packages'
const SOURCE = join(root, 'evolution-core/src/errors.ts')
const DOC = 'README.md'
const NL = String.fromCharCode(10)
import { stripComments as withoutComments } from './lib-source-text.mjs'

const codesIn = (text) => {
  const found = new Set()
  const re = /E-(\d{3})/g
  let match
  while ((match = re.exec(text)) !== null) found.add('E-' + match[1])
  return found
}

const sourceText = withoutComments(readFileSync(SOURCE, 'utf8'))
const docText = readFileSync(DOC, 'utf8')

// The source's literals are the table entries ('E-301: …'); the doc's are the table's first column.
const declared = codesIn(sourceText)
const documented = new Set()
for (const line of docText.split(NL)) {
  if (!line.startsWith('| ')) continue
  for (const code of codesIn(line.split('|')[1] ?? '')) documented.add(code)
}

const problems = []
for (const code of [...declared].sort()) {
  if (!documented.has(code)) problems.push(DOC + ' documents no row for ' + code + ' (it exists in ' + SOURCE + ')')
}
for (const code of [...documented].sort()) {
  if (!declared.has(code)) problems.push(SOURCE + ' no longer defines ' + code + ' (' + DOC + ' still documents it)')
}

// The stated range, if present, must match reality.
const sorted = [...declared].sort()
const min = sorted[0]
const max = sorted[sorted.length - 1]
if (min !== undefined && max !== undefined) {
  const range = '(`' + min + '`–`' + max + '`)'
  const flat = '（' + min + '–' + max + '）'
  if (!docText.includes(range) && !docText.includes(flat)) {
    problems.push(DOC + ' states no range matching the table (' + min + '–' + max + ')')
  }
}

if (problems.length > 0) {
  console.error('verify-error-codes: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-error-codes: OK — ' + declared.size + ' codes (' + min + '…' + max + '), all documented, range matches')
