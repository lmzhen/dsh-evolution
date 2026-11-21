#!/usr/bin/env node
/**
 * Gate-13: every family package with source has a real tsconfig graph.
 *
 * The previous row pointed at a helper under D:/dsh/audit-v37 that no longer exists. This check
 * judges the in-repo fact the row claimed: each live package's tsconfig exists, parses, extends the
 * family package base, and names references that resolve.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? 'packages')
if (!existsSync(root)) {
  console.error('verify-family-tsconfigs: CANNOT DECIDE - packages root not found: ' + root)
  process.exit(2)
}
const packages = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
  .map(entry => join(root, entry.name))
  .filter(dir => existsSync(join(dir, 'src')))

const problems = []
for (const dir of packages) {
  const file = join(dir, 'tsconfig.json')
  if (!existsSync(file)) {
    problems.push(join(dir, 'tsconfig.json') + ': source package has no tsconfig')
    continue
  }
  let config
  try {
    config = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    problems.push(file + ': cannot parse: ' + (error instanceof Error ? error.message : String(error)))
    continue
  }
  if (config.extends !== '../tsconfig.pkg.json') {
    problems.push(file + ': extends must be ../tsconfig.pkg.json, found ' + JSON.stringify(config.extends))
  }
  // The mirror carries platform references that only resolve in the overlay; those are not this
  // row's subject. Family-internal references must resolve.
  const underRoot = root + sep
  for (const reference of Array.isArray(config.references) ? config.references : []) {
    if (typeof reference?.path !== 'string') continue
    const target = resolve(dirname(file), reference.path)
    if (!target.startsWith(underRoot)) continue
    if (!existsSync(target)) problems.push(file + ': reference does not resolve: ' + JSON.stringify(reference.path))
  }
}
if (problems.length > 0) {
  console.error('verify-family-tsconfigs: ' + problems.length + ' problem(s):')
  for (const problem of problems.slice(0, 20)) console.error('  - ' + problem)
  process.exit(1)
}
console.log('verify-family-tsconfigs: ' + packages.length + ' source package(s) clean')
