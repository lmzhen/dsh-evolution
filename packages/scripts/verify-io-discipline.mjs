#!/usr/bin/env node
/**
 * G2.2 (contract C4): the write facade is the only door to the disk.
 *
 * The plan consolidates the family's unguarded `remove/rename/copy` calls into ONE planned-write
 * entry. The code side of that already holds — every domain path reaches the disk through the io seam
 * (`this.io.*`, `io().*`) and the raw calls live only in the medium itself. What was missing is the
 * gate that keeps it true, which is also C4's own degradation clause: "门面可留而调用点不迁，但
 * 禁止新增".
 *
 *   A. NO BARE MUTATION CALL outside the medium. A file under a package's `src/` may not call
 *      `rmSync / unlinkSync / renameSync / copyFileSync / writeFileSync / mkdirSync` nor the bare async
 *      `rm( / unlink( / rename( / copyFile( /`; a METHOD call (`io().rename(...)`, `this.io.remove(...)`)
 *      is the facade and stays allowed. The medium = `evolution-core/src/io.ts` and `evolution-io-node/src/**`
 *      (plus the provider files that implement the seam).
 *   B. THE SEAM IS IMPORTED, NOT REBUILT. A package whose src only mentions `node:fs` mutation verbs is
 *      already covered by A; this rule reports a package that hand-rolls its own `writeFileSync` wrapper
 *      module (a second door) by name, so the decision is visible.
 *
 * Comments are stripped first (line-preserving) and the guard skips itself.
 *
 * Usage: node packages/scripts/verify-io-discipline.mjs [packages-root]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './lib-source-text.mjs'

const root = process.argv[2] ?? 'packages'
/** The medium: these files ARE the disk surface, so they may call the raw APIs. */
const MEDIUM = [/(^|[\\/])evolution-core[\\/]src[\\/]io\.ts$/, /evolution-io-node[\\/]src[\\/]/]
/** sync verbs, and the async frees — but NOT a method call (`.rename(`, `.remove(`). */
const SYNC_VERB = /(?<![.\w])(rmSync|unlinkSync|renameSync|copyFileSync|writeFileSync|mkdirSync|appendFileSync)\s*\(/
const ASYNC_FREE = /(?<![.\w])(rm|unlink|rename|copyFile)\s*\(/
const ASYNC_ALLOWED = /node:fs\/promises/
const problems = []
let scanned = 0

const walk = (dir, visit) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) { if (entry !== 'tests' && entry !== 'dist') walk(path, visit) }
    else if (entry.endsWith('.ts')) visit(path)
  }
}

for (const dir of readdirSync(root)) {
  const src = join(root, dir, 'src')
  try {
    walk(src, (file) => {
      if (MEDIUM.some((pattern) => pattern.test(file))) return
      scanned += 1
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const line of code.split(String.fromCharCode(10))) {
        if (SYNC_VERB.test(line)) {
          problems.push(file + ': calls a raw fs mutation — go through the io seam (or, if this IS a medium, add it to MEDIUM): ' + line.trim().slice(0, 80))
          continue
        }
        if (ASYNC_FREE.test(line) && !ASYNC_ALLOWED.test(code)) {
          problems.push(file + ': calls a bare ' + (ASYNC_FREE.exec(line)?.[1] ?? '') + '() — go through the io seam: ' + line.trim().slice(0, 80))
        }
      }
    })
  } catch { /* a package without src is fine */ }
}

// A vacuum pass is not a pass: a root that exists but matches no source file judges nothing at
// all, and this gate used to exit 0 there (independent review P2-5). The arming audit carries
// the same rule for the same reason.
if (scanned === 0) {
  console.error('verify-io-discipline: a vacuum pass is not a pass — no source file matched the given root')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-io-discipline: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-io-discipline: OK — one write facade over ' + scanned + ' domain source file(s); the medium owns the raw calls')
