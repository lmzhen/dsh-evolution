import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

// G2-S2/G0: entry points are DERIVED from package.json exports (the same manifest the publish
// contract uses), not a hand-kept [index, tools] list. A new public subpath (composition,
// subagent, http-routes, restrictor) therefore produces its runtime artifact automatically;
// tsc emits lib/types/**/*.js first (rewriteRelativeImportExtensions), tsdown bundles each entry
// to lib/<subpath>.js. JSON/asset subpaths (no `types`) are skipped — they are not code entries.
function entriesFromExports() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const entry = {}
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    if (key !== '.' && (!key.startsWith('./') || key === './package.json')) continue
    const types = value && typeof value === 'object' ? value.types : undefined
    if (typeof types !== 'string' || !types.endsWith('.d.ts')) continue
    const js = types.replace(/\.d\.ts$/, '.js')
    const name = types.replace('./lib/types/', '').replace(/\.d\.ts$/, '')
    entry[name] = js
  }
  return entry
}

export default defineConfig(() => ({
  workspace: false,
  cwd: process.cwd(),
  entry: entriesFromExports(),
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}))
