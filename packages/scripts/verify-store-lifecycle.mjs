#!/usr/bin/env node
/**
 * DCR-85 lifecycle gate: optional family services must not be REQUIRED dependencies.
 *
 * Cordis `inject` names are required: while one is missing, the fiber stays
 * INACTIVE and the whole row disappears (issue #23 / PR #26). This gate parses
 * the `inject` declaration only; it deliberately does not guess expression
 * shapes for `ctx.get` captures. Use-time captures are covered by behavioral
 * tests (installation matrix, HMR/late-provide, activation guards), because a
 * static pattern can never be a proof of "resolved at use time".
 *
 * The optional names are public Cordis service contract names, not function
 * names; keep them in this one list so a review can see every optional family
 * capability in one place.
 *
 * Usage: node packages/scripts/verify-store-lifecycle.mjs packages [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages'
const OPTIONAL = new Set(['evolutionStore', 'evolutionMutationAuthority'])
const problems = []
let scanned = 0

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'tests' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) { walk(path, visit); continue }
    if (entry.endsWith('.ts')) visit(path)
  }
}

/** Read the `inject` declaration; literal=false means an audit-unfriendly expression. */
function declaredInject(text) {
  const start = /\b(?:(?:export\s+)?const|static)\s+inject\b/.exec(text)
  if (start === null) return null
  const equals = text.indexOf('=', start.index)
  if (equals < 0) return { names: [], literal: false }
  const rest = text.slice(equals + 1)
  const array = /^\s*\[([\s\S]*?)\]/.exec(rest)
  if (array === null) return { names: [], literal: false }
  const body = array[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const strings = [...body.matchAll(/['"]([^'"]+)['"]/g)].map(entry => entry[1])
  const literal = body.replace(/['"][^'"]*['"]/g, '').replace(/[\s,]/g, '') === ''
  return { names: strings, literal }
}

function audit(path, text) {
  const rel = relative(root, path)
  const inject = declaredInject(text)
  if (inject === null) return
  if (!inject.literal) {
    problems.push(rel + ': inject must be a literal string array so optional names stay auditable')
    return
  }
  for (const name of inject.names) {
    if (OPTIONAL.has(name)) problems.push(rel + ': lists optional ' + name + ' in required inject (use a use-time resolver / ctx.inject)')
  }
}

for (const pkg of readdirSync(root)) {
  const src = join(root, pkg, 'src')
  try { walk(src, path => { scanned += 1; audit(path, readFileSync(path, 'utf8')) }) } catch { /* package without src */ }
}

if (process.argv.includes('--self-test')) {
  const shouldRed = [
    "export const inject = ['tools', 'evolutionMutationAuthority']",
    "export const inject = ['evolutionStore', 'tools']",
    "const x = 1\nexport const inject = ['tools', 'skillUsage', 'evolutionMutationAuthority']",
    "class Row { static inject = ['evolutionStore', 'tools'] }",
    "class Row { static inject = pickInject() }",
    'const required = [\'tools\']\nexport const inject = [...required]',
    "export const inject = required",
  ]
  const shouldGreen = [
    "export const inject = ['tools', 'skillUsage', 'evolutionIo']",
    "export const inject: string[] = []",
    "export const inject = ['slots', 'locale'] as const",
    "export const inject = ['tools', /* authority is optional */ 'evolutionIo']",
    "class Row { static inject = ['tools', 'evolutionIo'] }",
  ]
  let failed = false
  for (const fake of shouldRed) {
    const before = problems.length
    audit('__self-test__.ts', fake)
    if (problems.length <= before) { failed = true; console.error('not detected: ' + fake) }
    problems.length = before
  }
  for (const fake of shouldGreen) {
    const before = problems.length
    audit('__self-test__.ts', fake)
    if (problems.length !== before) { failed = true; console.error('false positive: ' + fake) }
    problems.length = before
  }
  if (failed) {
    console.error('verify-store-lifecycle: SELF-TEST FAILED — inject parsing is not trustworthy')
    process.exit(1)
  }
  console.log('verify-store-lifecycle: self-test OK — optional names in required inject turn the gate red')
  process.exit(0)
}

if (scanned === 0) {
  console.error('verify-store-lifecycle: a vacuum pass is not a pass — no source file matched')
  process.exit(1)
}
if (problems.length > 0) {
  console.error('verify-store-lifecycle: ' + String(problems.length) + ' lifecycle violation(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-store-lifecycle: OK — ' + String(scanned) + ' package source file(s) declare inject with required services only')
