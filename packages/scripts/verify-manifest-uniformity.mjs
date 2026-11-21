#!/usr/bin/env node
/**
 * Gate-14: the family package manifests agree with the family version.
 *
 * The previous row pointed at a helper under D:/dsh/audit-v37 that no longer exists. This check
 * judges the in-repo fact: every published family package carries the root family version, so a
 * release cannot ship a mixed manifest set.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'packages')
if (!existsSync(join(root, '..', 'package.json'))) {
  console.error('verify-manifest-uniformity: CANNOT DECIDE - root package.json not found above ' + root)
  process.exit(2)
}
const expected = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8')).version
if (typeof expected !== 'string' || expected.trim() === '') {
  console.error('verify-manifest-uniformity: CANNOT DECIDE - root package.json has no version')
  process.exit(2)
}
const problems = []
const packages = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
for (const entry of packages) {
  const manifest = join(root, entry.name, 'package.json')
  if (!existsSync(manifest)) continue
  let version
  try {
    version = JSON.parse(readFileSync(manifest, 'utf8')).version
  } catch (error) {
    problems.push(manifest + ': cannot parse: ' + (error instanceof Error ? error.message : String(error)))
    continue
  }
  if (version !== expected) problems.push(manifest + ': version ' + JSON.stringify(version) + ' != ' + expected)
}
if (problems.length > 0) {
  console.error('verify-manifest-uniformity: ' + problems.length + ' problem(s):')
  for (const problem of problems.slice(0, 20)) console.error('  - ' + problem)
  process.exit(1)
}
console.log('verify-manifest-uniformity: ' + packages.length + ' manifest(s) at ' + expected)
