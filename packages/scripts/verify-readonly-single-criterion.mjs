#!/usr/bin/env node
/**
 * G7.2 (audit F-2): the read-only action CRITERION is spelled once.
 *
 * skill_manage's read-only set (list/review/pin/unpin) used to be written out four times in one file
 * — usage accounting, the cross-source exemption, the approval gap, the replay exemption. The four
 * USES stay where they are (their neighbouring logic differs); the CRITERION lives in
 * READ_ONLY_ACTIONS / isReadOnlyAction, so adding an action cannot update three of four.
 *
 * This gate fails when the inline four-way comparison reappears, or when the predicate goes missing.
 *
 *   A. some source file defines isReadOnlyAction + READ_ONLY_ACTIONS;
 *   B. NO source file spells the comparison out again (that is the drift this gate exists for).
 *
 * Comments are stripped first; the guard skips its own file (its pattern literals name the shape).
 *
 * Usage: node packages/scripts/verify-readonly-single-criterion.mjs [packages-root]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './lib-source-text.mjs'

const root = process.argv[2] ?? 'packages'
const INLINE = /!==\s*'list'\s*&&[^\n]*!==\s*'unpin'/
const problems = []
let scanned = 0
let defines = 0

const walk = (dir, visit) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path, visit) }
    else if (entry.name.endsWith('.ts')) visit(path)
  }
}

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('evolution-') && entry.name !== 'tool-skill-manage') continue
  const src = join(root, entry.name, 'src')
  try {
    walk(src, (file) => {
      if (file.endsWith('verify-readonly-single-criterion.mjs')) return
      scanned += 1
      const text = stripComments(readFileSync(file, 'utf8'))
      if (/const isReadOnlyAction\b/.test(text) && /READ_ONLY_ACTIONS\b/.test(text)) defines += 1
      if (INLINE.test(text)) {
        problems.push(file + ': spells the read-only comparison inline again — call isReadOnlyAction')
      }
    })
  } catch (error) {
    problems.push(src + ': unreadable (' + String(error.message) + ')')
  }
}

if (defines === 0) problems.push('no source file defines isReadOnlyAction + READ_ONLY_ACTIONS (the criterion is missing)')
if (defines > 1) problems.push('the criterion is defined in ' + defines + ' files — it must live once')

if (problems.length > 0) {
  console.error('verify-readonly-single-criterion: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-readonly-single-criterion: OK — 1 criterion, ' + scanned + ' source file(s) scanned')
