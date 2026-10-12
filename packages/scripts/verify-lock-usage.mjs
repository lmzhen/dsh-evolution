#!/usr/bin/env node
/**
 * G6-② (v46) — every profile-patch WRITE in the family must go through the platform's serialization.
 *
 * The profile patch is a read-modify-write: /evolution preset install reads profile.patchPath, merges a
 * row and commits atomically. Two of those running at once lose one update, and the platform's own
 * answer to that class is its HMR lock (dsh-plugin-manager: hmr === undefined ? apply() :
 * hmr.runExclusive(apply)). This gate keeps the rule in the code:
 *
 *   A. a source file that writes a profile patch must call runExclusive;
 *   B. it must keep the platform's degrade shape — the direct call when no hmr service is mounted
 *      (a hard dependency on an optional service would refuse hosts that do not mount it).
 *
 * The standalone installer (packages/scripts/install-layered.mjs) runs OUTSIDE the host and has no ctx:
 * it is deliberately out of scope here and recorded as such in the batch ledger.
 *
 * Usage: node packages/scripts/verify-lock-usage.mjs [packages-root]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'packages'
const problems = []
let checked = 0
const NL = String.fromCharCode(10)
/**
 * Comments must not satisfy a rule: the first drill passed only because the docblock quoted the
 * platform's own `hmr.runExclusive(apply)` line. Strip comments, KEEP line numbers (the family's
 * probe discipline: strip comments, then match the declared shape, and a miss is a problem).
 */
import { stripComments as withoutComments } from './lib-source-text.mjs'

const walk = (dir, visit) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(path, visit)
    } else if (entry.name.endsWith('.ts')) visit(path)
  }
}

const patches = (text) => text.includes('atomicWriteFiles(') && text.includes('patchPath')

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('evolution-')) continue
  const src = join(root, entry.name, 'src')
  let files = []
  try { files = [] } catch { files = [] }
  const collected = []
  const collect = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name)
      if (item.isDirectory()) { if (item.name !== 'node_modules') collect(path) }
      else if (item.name.endsWith('.ts')) collected.push(path)
    }
  }
  try { collect(src) } catch { continue }
  for (const file of collected) {
    const text = withoutComments(readFileSync(file, 'utf8'))
    if (!patches(text)) continue
    checked += 1
    // A: the lock is actually CALLED (not merely named in a type or a comment).
    if (!/runExclusive\.call\(|runExclusive\(/.test(text)) {
      problems.push(file + ': writes a profile patch without calling the platform HMR lock (runExclusive)')
      continue
    }
    // B: the platform's degrade shape survives.
    if (!/runExclusive\s*===\s*undefined/.test(text) && !/hmr\s*===\s*undefined/.test(text)) {
      problems.push(file + ': wraps the write but drops the degrade branch (hmr === undefined ? direct : locked)')
    }
  }
}

if (problems.length > 0) {
  console.error('verify-lock-usage: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-lock-usage: OK — ' + checked + ' profile-patch writer(s), all serialized through the platform lock')
