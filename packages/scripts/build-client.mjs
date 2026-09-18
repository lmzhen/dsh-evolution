#!/usr/bin/env node
/**
 * Build the family's browser halves (G4/S4.4).
 *
 * A client half must ship as the client module system's lazy CJS factory:
 *   window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })
 * The platform's own preset (packages/client/tsdown.client.ts) is not published
 * for packages outside its repository, so this script asks tsdown for a plain
 * CommonJS body and wraps it itself. Everything outside the package stays
 * external and resolves through the `require` the loader injects.
 *
 * Runnable only where the project references resolve — the upstream OVERLAY, like
 * build-lib.mjs. Usage: node packages/scripts/build-client.mjs [package …]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evolutionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(evolutionRoot, '../..')
const tsdown = join(repoRoot, 'node_modules', 'tsdown', 'dist', 'run.mjs')

/** Packages that declare a browser half, in directory order. */
function clientPackages() {
  const requested = process.argv.slice(2)
  return readdirSync(evolutionRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => requested.length === 0 || requested.includes(name))
    .filter(name => {
      const manifest = join(evolutionRoot, name, 'package.json')
      if (!existsSync(manifest)) return false
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      return parsed.dsh?.client !== undefined && existsSync(join(evolutionRoot, name, 'src', 'client', 'index.ts'))
    })
    .sort()
}

/** Wrap one CommonJS body into the loader's factory artifact. */
function artifact(id, body) {
  const indented = body.split(/\r?\n/).map(line => line === '' ? '' : '\t\t' + line).join('\n')
  return [
    'window.__ModuleLoader__.load({',
    '\tid: ' + JSON.stringify(id) + ',',
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    indented,
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n')
}

const packages = clientPackages()
if (packages.length === 0) {
  console.log('build-client: no package declares dsh.client')
  process.exit(0)
}
for (const name of packages) {
  const cwd = join(evolutionRoot, name)
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const staging = join(cwd, '.client-build')
  const config = join(cwd, 'tsdown.client.tmp.mjs')
  writeFileSync(config, [
    'export default {',
    '  workspace: false,',
    "  entry: ['src/client/index.ts'],",
    "  outDir: '.client-build',",
    "  format: ['cjs'],",
    "  platform: 'browser',",
    "  target: 'es2022',",
    '  dts: false,',
    '  clean: true,',
    "  external: [/^react($|\\/)/, /^@deepseek-ai\\//],",
    "  outputOptions: { entryFileNames: 'client.body.js' },",
    '}',
    '',
  ].join('\n'), 'utf8')
  try {
    console.log('client build: ' + name)
    const result = spawnSync(process.execPath, [tsdown, '--config', 'tsdown.client.tmp.mjs'], { cwd, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
    const body = readFileSync(join(staging, 'client.body.js'), 'utf8')
    mkdirSync(join(cwd, 'lib'), { recursive: true })
    writeFileSync(join(cwd, 'lib', 'client.js'), artifact(manifest.name, body), 'utf8')
    console.log('client build: wrote ' + join(name, 'lib', 'client.js'))
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(config, { force: true })
  }
}
