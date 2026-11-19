#!/usr/bin/env node
/**
 * Phase 0/1 dual-line compile harness.
 *
 * Compiles the family's HOST production sources against two independent sets of
 * platform declarations:
 *   - rc1: an installed @deepseek-ai tree (e.g. .../dsh/node_modules/@deepseek-ai)
 *   - rc3: a source checkout whose platform packages were built (lib/types)
 *
 * No platform source is compiled; every @deepseek-ai/dsh-* root and known
 * subpath resolves to that line's .d.ts. Family packages resolve to the repo's
 * src (the base tsconfig already owns the family paths).
 *
 * Usage:
 *   node packages/scripts/verify-platform-matrix.mjs \
 *     --rc1-types <.../@deepseek-ai> \
 *     --rc3-root <platform-source-root> \
 *     --deps-root <overlay-with-node_modules> \
 *     [--tsc <typescript/bin/tsc>] [--json] [--keep]
 *
 * Exit 0 = both lines 0 errors. Exit 1 = at least one line has errors or a
 * required input is missing. This is a detector, not a version shim.
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Names of this repository's packages, so a platform tree that vendors an old
 * family copy does not supply a second declaration identity for them. */
function familyPackageNames() {
  const names = new Set()
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(root, 'packages', entry.name, 'package.json')
    if (!existsSync(file)) continue
    try {
      const name = JSON.parse(readFileSync(file, 'utf8')).name
      if (typeof name === 'string') names.add(name)
    } catch { /* ignored: a malformed manifest is another gate's finding */ }
  }
  return names
}
const args = process.argv.slice(2)
const valueOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const required = (name) => {
  const value = valueOf(name)
  if (value === undefined || value.startsWith('--')) {
    console.error('missing ' + name)
    process.exit(2)
  }
  return resolve(value)
}
const rc1Arg = valueOf('--rc1-types')
const rc1Types = rc1Arg === undefined || rc1Arg.startsWith('--') ? undefined : resolve(rc1Arg)
const rc3Root = required('--rc3-root')
const depsRoot = required('--deps-root')
const tsc = valueOf('--tsc') !== undefined ? resolve(valueOf('--tsc')) : join(depsRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const jsonOut = args.includes('--json')
const keep = args.includes('--keep')

const base = JSON.parse(readFileSync(join(root, 'tsconfig.base.json'), 'utf8').replace(/\/\/.*$/gm, ''))
const basePaths = base.compilerOptions?.paths ?? {}

function packageMapFromTypesRoot(typesRoot, recursive) {
  const map = new Map()
  const add = (dir) => {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (typeof pkg.name === 'string' && existsSync(join(dir, 'lib', 'types', 'index.d.ts'))) map.set(pkg.name, dir)
      } catch { /* ignore malformed package.json */ }
    }
  }
  if (!recursive) {
    for (const entry of readdirSync(typesRoot)) {
      const dir = join(typesRoot, entry)
      if (statSync(dir).isDirectory()) add(dir)
    }
    // An installed app can expose every platform package only through pnpm's
    // content-addressed store (<root>/.pnpm/<hash>/node_modules/@deepseek-ai/*),
    // not as flat @deepseek-ai/<name> entries. Read that store as the same
    // single declaration tree; a flat installed layout wins when both exist.
    const store = join(typesRoot, '.pnpm')
    if (existsSync(store)) {
      for (const entry of readdirSync(store)) {
        const scope = join(store, entry, 'node_modules', '@deepseek-ai')
        if (!existsSync(scope)) continue
        for (const name of readdirSync(scope)) {
          const dir = join(scope, name)
          if (statSync(dir).isDirectory()) add(dir)
        }
      }
    }
    return map
  }
  const walk = (dir) => {
    add(dir)
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'lib' || entry === 'dist') continue
      const child = join(dir, entry)
      if (statSync(child).isDirectory()) walk(child)
    }
  }
  for (const top of ['packages', 'vendor']) {
    const dir = join(typesRoot, top)
    if (existsSync(dir)) walk(dir)
  }
  return map
}

function typePathsFor(map) {
  const paths = {}
  for (const [name, dir] of map) {
    paths[name] = [join(dir, 'lib', 'types', 'index.d.ts').replaceAll('\\', '/')]
    const dtsRoot = join(dir, 'lib', 'types')
    const walk = (d) => {
      for (const entry of readdirSync(d)) {
        const full = join(d, entry)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (!entry.endsWith('.d.ts')) continue
        const rel = full.slice(dtsRoot.length + 1).replaceAll('\\', '/')
        const sub = rel === 'index.d.ts' ? undefined : rel.endsWith('/index.d.ts') ? rel.slice(0, -'/index.d.ts'.length) : rel.slice(0, -'.d.ts'.length)
        if (sub !== undefined) {
          const key = name + '/' + sub
          if (!paths[key]) paths[key] = [full.replaceAll('\\', '/')]
        }
      }
    }
    if (existsSync(dtsRoot)) walk(dtsRoot)
  }
  // Older platform declarations import cordis through its source-shaped subpaths
  // (`@deepseek-ai/cordis/src/logger`). The built tree exposes those at
  // lib/types/<name>.d.ts, so map both shapes explicitly instead of letting the
  // family's stale node_modules junction win.
  const cordis = map.get('@deepseek-ai/cordis')
  if (cordis !== undefined) {
    const dts = join(cordis, 'lib', 'types')
    paths['@deepseek-ai/cordis/*'] = [dts.replaceAll('\\', '/') + '/*.d.ts']
    // Exact source-spelling aliases. A broad `src/*` pattern wins the match for
    // `src/context.ts` and then fails on `context.ts.d.ts`; TypeScript does not
    // fall through to a suffix pattern, so enumerate the root d.ts files.
    for (const entry of readdirSync(dts)) {
      if (!entry.endsWith('.d.ts') || entry.endsWith('.d.ts.map')) continue
      const stem = entry.slice(0, -'.d.ts'.length)
      const target = join(dts, entry).replaceAll('\\', '/')
      paths['@deepseek-ai/cordis/src/' + stem] = [target]
      paths['@deepseek-ai/cordis/src/' + stem + '.ts'] = [target]
      paths['@deepseek-ai/cordis/' + stem] = [target]
    }
  }
  return paths
}

function pnpmPackage(namePrefix) {
  const pnpm = join(depsRoot, 'node_modules', '.pnpm')
  if (!existsSync(pnpm)) return undefined
  const dir = readdirSync(pnpm).find((entry) => entry.startsWith(namePrefix + '@'))
  return dir === undefined ? undefined : join(pnpm, dir, 'node_modules', namePrefix)
}

function makeConfig(line, platformPaths) {
  const merged = { ...basePaths, ...platformPaths }
  // Base paths are written relative to the repo-root tsconfig; this config lives
  // under packages/scripts, so make every relative target absolute first.
  const paths = {}
  for (const [key, values] of Object.entries(merged)) {
    paths[key] = values.map((value) => value.startsWith('./') ? root.replaceAll('\\', '/') + '/' + value.slice(2) : value)
  }
  paths['yaml'] = [pnpmPackage('yaml') ?? join(depsRoot, 'node_modules', 'yaml')]
  paths['zod'] = [join(depsRoot, 'node_modules', 'zod')]
  paths['zod/*'] = [join(depsRoot, 'node_modules', 'zod', '*')]
  const mini = pnpmPackage('minisearch')
  if (mini !== undefined) paths['minisearch'] = [mini]
  const mergeEngine = join(root, 'packages', 'evolution-merge-engine', 'src', 'index.d.ts')
  if (existsSync(mergeEngine)) {
    paths['@deepseek-ai/dsh-evolution-merge-engine'] = [mergeEngine.replaceAll('\\', '/')]
  }
  return {
    extends: join(root, 'tsconfig.base.json'),
    compilerOptions: {
      noEmit: true,
      declaration: false,
      declarationMap: false,
      composite: false,
      incremental: false,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      moduleResolution: 'bundler',
      module: 'esnext',
      target: 'es2024',
      esModuleInterop: true,
      strict: true,
      types: ['node'],
      typeRoots: [join(depsRoot, 'node_modules', '@types')],
      paths,
    },
    include: [
      root.replaceAll('\\', '/') + '/packages/**/src/**/*.ts',
      root.replaceAll('\\', '/') + '/packages/test-support/**/*.ts',
    ],
    exclude: [
      root.replaceAll('\\', '/') + '/packages/**/src/**/*.tsx',
      root.replaceAll('\\', '/') + '/packages/**/src/client/**',
      root.replaceAll('\\', '/') + '/packages/**/*.client.ts',
      root.replaceAll('\\', '/') + '/packages/evolution-client-kit/**',
      root.replaceAll('\\', '/') + '/packages/evolution-ui/**',
      root.replaceAll('\\', '/') + '/packages/evolution-merge-ui/**',
      root.replaceAll('\\', '/') + '/packages/evolution-skill-health/src/client/**',
    ],
  }
}

function runLine(line, platformPaths) {
  if (!existsSync(tsc)) return { line, ok: false, errors: -1, output: 'tsc not found: ' + tsc }
  const configPath = join(root, 'packages', 'scripts', '.tsconfig-matrix-' + line + '.tmp.json')
  writeFileSync(configPath, JSON.stringify(makeConfig(line, platformPaths), null, 2))
  try {
    const run = spawnSync(process.execPath, [tsc, '-p', configPath, '--pretty', 'false'], { cwd: root, encoding: 'utf8' })
    const output = (run.stdout ?? '') + (run.stderr ?? '')
    const errors = output.split(/\r?\n/).filter((lineText) => /error TS\d+/.test(lineText)).length
    return { line, ok: run.status === 0 && errors === 0, errors, status: run.status, output }
  } finally {
    if (!keep) unlinkSync(configPath)
  }
}

const rc1Map = rc1Types === undefined ? new Map() : packageMapFromTypesRoot(rc1Types, false)
const rc3Map = packageMapFromTypesRoot(rc3Root, true)
const ownPackages = familyPackageNames()
for (const name of ownPackages) {
  rc1Map.delete(name)
  rc3Map.delete(name)
}
const results = [
  ...(rc1Types === undefined ? [] : [runLine('rc1', typePathsFor(rc1Map))]),
  runLine('rc3', typePathsFor(rc3Map)),
]
const report = {
  ok: results.every((r) => r.ok),
  ...(rc1Types === undefined ? {} : { rc1Types }),
  rc3Root,
  rc1Packages: rc1Map.size,
  rc3Packages: rc3Map.size,
  results: results.map((r) => ({ line: r.line, ok: r.ok, errors: r.errors, status: r.status })),
}
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else for (const r of results) console.log(r.line + ': ' + (r.ok ? 'OK' : 'FAIL') + ' (' + r.errors + ' errors)')
if (!report.ok) {
  for (const r of results) {
    if (r.ok) continue
    const lines = r.output.split(/\r?\n/).filter(Boolean)
    console.error('--- ' + r.line + ' ---')
    for (const text of lines.slice(0, 40)) console.error(text)
  }
  process.exit(1)
}
