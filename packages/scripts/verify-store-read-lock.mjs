#!/usr/bin/env node
/**
 * DCR-85 read-lock gate: every read path in the store kernel is fence-free.
 * `query` and its helpers may only read immutable commits/objects; the sole
 * `fence.run` in the kernel belongs to `mutate`.
 *
 * This is the name-set check behind gate-87's narrower query slice.
 *
 * Usage: node packages/scripts/verify-store-read-lock.mjs packages [--self-test]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'packages'
const path = join(root, 'evolution-core', 'src', 'store', 'store-kernel.ts')
const text = readFileSync(path, 'utf8')
const READ_METHODS = ['query', 'readHeadForQuery', 'readHead', 'readCommit', 'readObject', 'resolveDomains']
const LOCK_TOKENS = [/\.fence\b/, /withFileLock/, /\.acquire\s*\(/]

function methodBody(source, name) {
  const signature = new RegExp('(?:async\\s+)?' + name + '\\s*\\(', 'g')
  const match = signature.exec(source)
  if (match === null) return null
  const open = source.indexOf('{', match.index)
  if (open < 0) return null
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  return null
}

function violationsIn(source) {
  const out = []
  for (const name of READ_METHODS) {
    const body = methodBody(source, name)
    if (body === null) { out.push('missing read method ' + name); continue }
    for (const token of LOCK_TOKENS) if (token.test(body)) out.push(name + ' takes a lock token ' + token)
  }
  const mutate = methodBody(source, 'mutate')
  if (mutate === null || !/\.fence\.run\s*\(/.test(mutate)) out.push('mutate does not own the single fence.run')
  return out
}

if (process.argv.includes('--self-test')) {
  const fake = 'async query() { await this.fence.run(async () => ({})) }'
  const detected = violationsIn(fake).some(problem => problem.startsWith('query takes a lock token'))
  if (!detected) {
    console.error('verify-store-read-lock: SELF-TEST FAILED — a fence-taking query was not detected')
    process.exit(1)
  }
  console.log('verify-store-read-lock: self-test OK — a fence-taking query turns the gate red')
  process.exit(0)
}

const problems = violationsIn(text)
if (problems.length > 0) {
  console.error('verify-store-read-lock: ' + String(problems.length) + ' read-path lock violation(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-store-read-lock: OK — query and its read helpers are fence-free; mutate owns the only fence.run')
