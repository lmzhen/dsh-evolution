#!/usr/bin/env node
/**
 * G7-3 (份数=1): the family has exactly ONE atomic writer, and it lives in the seam.
 *
 * The write path used to be duplicated: evolution-commands carried its own F-211-hardened
 * tmp+rename writer while the io seam had another. This gate keeps the count at one by refusing a
 * second sync commit sequence anywhere in the family's src:
 *
 *   renameSync( together with a .tmp staging name == a private atomic writer.
 *
 * The home is evolution-core/src/io.ts (the seam). Consumers reach it through the seam or through
 * the package entry — never by growing a copy.
 *
 * Usage: node packages/scripts/verify-atomic-write-single-source.mjs [packages-root]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
// Dogfood: judge code, not prose (an apostrophe in a comment must not decide this).
import { stripComments } from './lib-source-text.mjs'

const root = process.argv[2] ?? 'packages'
const HOME = join('evolution-core', 'src', 'io.ts')
const problems = []
let scanned = 0

const walk = (dir, visit) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path, visit) }
    else if (entry.name.endsWith('.ts')) visit(path)
  }
}

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('evolution-')) continue
  const src = join(root, entry.name, 'src')
  try {
    walk(src, (file) => {
      // The guard skips itself: its own pattern literals mention the sequence it forbids.
      if (file.endsWith('verify-atomic-write-single-source.mjs')) return
      scanned += 1
      const text = stripComments(readFileSync(file, 'utf8'))
      if (!text.includes('renameSync(') || !text.includes('.tmp')) return
      if (file.endsWith(HOME)) return
      problems.push(file + ': carries a private atomic-write sequence — use the seam in ' + HOME)
    })
  } catch (error) {
    problems.push(src + ': unreadable (' + String(error.message) + ')')
  }
}

// A vacuum pass is not a pass: a root that exists but matches no source file judges nothing at
// all, and this gate used to exit 0 there (independent review P2-5). The arming audit carries
// the same rule for the same reason.
if (scanned === 0) {
  console.error('verify-atomic-write-single-source: a vacuum pass is not a pass — no source file matched the given root')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-atomic-write-single-source: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-atomic-write-single-source: OK — 1 atomic writer (' + HOME + '), ' + scanned + ' source file(s) scanned')
