#!/usr/bin/env node
/**
 * Publish preparation for the evolution package family.
 *
 * Packs every package from a pristine copy with publish-ready manifests:
 *   - workspace:^ is converted to real semver ranges
 *   - --scope renames our packages, YAML rows, repository metadata and
 *     removes unpublished ./src/* export shims
 *   - --version pins the release version; --platform-version pins the
 *     published upstream platform the dsh-* ranges target (N-2 single
 *     source: one workflow variable drives both the compat gate's
 *     upstream_ref and this metadata)
 *   - tarballs are validated before manifest/smoke artifacts are written
 *
 * Version single-source (M4 §5.3): the release workflow's environment is the
 * only place that pins `RELEASE_VERSION` / `PLATFORM_VERSION`; this script
 * requires them rather than carrying its own defaults, so a version can never
 * silently drift between the workflow and the pack step.
 *
 * Usage:
 *   node packages/evolution/scripts/build-lib.mjs
 *   node packages/evolution/scripts/prepare-release.mjs \
 *     --scope @lmzhen --version 0.1.0-rc.NN --platform-version 0.1.1-rc.NN
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evolutionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(evolutionRoot, '../..')
const distRoot = join(evolutionRoot, 'dist')
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

function requireArg(name) {
  const value = arg(name)
  if (!value) throw new Error(`prepare-release: missing required ${name}; the release workflow pins it (single source)`)
  return value
}

const scope = requireArg('--scope')
const releaseVersion = requireArg('--version')
const platformVersion = requireArg('--platform-version')

const sourceDirs = readdirSync(evolutionRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(evolutionRoot, entry.name, 'package.json')))
  .map(entry => entry.name)
  .sort()

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function npmPack(cwd) {
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/c', 'npm', 'pack', '--json'], { cwd, encoding: 'utf8' })
  }
  return execFileSync('npm', ['pack', '--json'], { cwd, encoding: 'utf8' })
}

function registryVersion(name) {
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/c', 'npm', 'view', name, 'version']]
    : ['npm', ['view', name, 'version']]
  try {
    return execFileSync(command[0], command[1], { encoding: 'utf8' }).trim().split(String.fromCharCode(10)).pop() ?? ''
  } catch {
    return ''
  }
}

function currentGitSha() {
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/c', 'git', 'rev-parse', 'HEAD']]
    : ['git', ['rev-parse', 'HEAD']]
  try {
    return execFileSync(command[0], command[1], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function scopedPackageName(name) {
  return scope ? `${scope}/${name.slice('@deepseek-ai/'.length)}` : name
}

function releaseSpec(name, ourNames, publishedVersions) {
  if (ourNames.has(name)) return `^${releaseVersion}`
  if (name === '@deepseek-ai/cordis') return '^4.0.1'
  if (name === '@deepseek-ai/schemastery') return '^3.18.1'
  // Platform packages range against the published upstream version, NOT the
  // development baseline — CI guards manifest parity with the compat anchor
  // (verify-platform-ranges.mjs, N-2).
  if (name.startsWith('@deepseek-ai/dsh-')) return `^${platformVersion}`
  const published = publishedVersions[name]
  if (published) return published.startsWith('^') ? published : `^${published}`
  return `^${releaseVersion}`
}

function rewritePackage(pkg, ourNames, publishedVersions) {
  pkg.version = releaseVersion
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      let rewritten = name
      if (scope && ourNames.has(name)) rewritten = scopedPackageName(name)
      if (spec === 'workspace:^') pkg[section][name] = releaseSpec(name, ourNames, publishedVersions)
      if (rewritten !== name) {
        pkg[section][rewritten] = pkg[section][name]
        delete pkg[section][name]
      }
    }
  }
  if (scope) {
    pkg.name = `${scope}/${pkg.name.slice('@deepseek-ai/'.length)}`
    pkg.repository = {
      type: 'git',
      url: 'git+https://github.com/lmzhen/dsh-evolution.git',
      directory: `packages/${pkg.name.split('/')[1]}`,
    }
    delete pkg.exports?.['./src/*']
    if (typeof pkg.description === 'string') pkg.description = `${pkg.description} (community build)`
  }
  return pkg
}

function rewriteScopedText(text, names) {
  if (!scope) return text
  let out = text
  for (const name of names) out = out.split(name).join(scopedPackageName(name))
  return out
}

function rewriteScopedJs(stagedDir, names) {
  if (!scope) return
  const libRoot = join(stagedDir, 'lib')
  if (!existsSync(libRoot)) return
  const stack = [libRoot]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      // F-104: published `files` whitelists carry `lib/types/**/*.d.ts` (e.g.
      // evolution-approval), so a published .d.ts that re-exports a family
      // package under its original `@deepseek-ai/dsh-*` name surfaces a TS2307
      // in the consumer. Rewrite .d.ts with the SAME scope replacement used for
      // .js (`export type X from '@deepseek-ai/...'`, `import type` and source
      // lines all reduce to the same text substitution).
      else if (entry.isFile() && (path.endsWith('.js') || path.endsWith('.d.ts'))) {
        writeFileSync(path, rewriteScopedText(readFileSync(path, 'utf8'), names))
      }
    }
  }
}

/** Relative paths (posix separators) of every runtime bundle under lib/,
 * skipping the tsc-only `types/` tree (never ships; it still carries the
 * workspace names and would trip the unrewritten-scope guard). */
function libBundles(libRoot) {
  const out = []
  const stack = [libRoot]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!(current === libRoot && entry.name === 'types')) stack.push(join(current, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(join(current, entry.name).slice(libRoot.length + 1).split('\\').join('/'))
      }
    }
  }
  return out
}

/** The exact paths npm resolved into the tarball (from `npm pack --json`
 * `files`), normalized to posix with any leading `./` stripped so they line up
 * with `exports` targets, `main`/`types` and `lib/...` bundle imports. */
function shippedPaths(packed) {
  return (packed.files ?? []).map(f => (typeof f === 'string' ? f : f.path).replace(/^\.\//, '').replace(/\\/g, '/'))
}

const staging = join(evolutionRoot, '.release-staging')
// Build into `.next` dirs and swap at the end (F-350): the live dist/staging
// are only touched once the whole build AND its guard pass, so a mid-build or
// mid-pack failure never leaves a partial `dist` or a partially-populated
// `.release-staging` for a later step (e.g. verify-platform-ranges or the
// scoped installer) to pick up.
const distNext = `${distRoot}.next`
const stagingNext = `${staging}.next`
rmSync(distNext, { recursive: true, force: true })
rmSync(stagingNext, { recursive: true, force: true })
mkdirSync(distNext, { recursive: true })
mkdirSync(stagingNext, { recursive: true })

const names = new Map(sourceDirs.map(dir => [readJson(join(evolutionRoot, dir, 'package.json')).name, dir]))
const externalNames = new Set()
for (const dir of sourceDirs) {
  const pkg = readJson(join(evolutionRoot, dir, 'package.json'))
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (spec === 'workspace:^' && !names.has(name)) externalNames.add(name)
    }
  }
}
const publishedVersions = {}
for (const name of externalNames) publishedVersions[name] = registryVersion(name)

const tarballs = []
for (const dir of sourceDirs) {
  const original = join(evolutionRoot, dir)
  const staged = join(stagingNext, dir)
  cpSync(original, staged, {
    recursive: true,
    force: true,
    filter(path) {
      const base = path.slice(original.length + 1)
      return base !== 'node_modules' && !base.startsWith('tests')
    },
  })
  const manifestPath = join(staged, 'package.json')
  const manifest = rewritePackage(readJson(manifestPath), new Set(names.keys()), publishedVersions)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  for (const file of ['cordis.yml', 'cordis.patch.yml', 'agent.cordis.yml', 'preset.yml']) {
    const path = join(staged, file)
    if (existsSync(path)) writeFileSync(path, rewriteScopedText(readFileSync(path, 'utf8'), names.keys()))
  }
  // names.keys() is a ONE-SHOT iterator: passing it straight into the walk
  // would let the first file's rewrite consume every name and leave all
  // later files unrewritten (0.3.0 bug: tools.js kept @deepseek-ai/dsh-*).
  // A materialized array stays re-iterable for each file.
  rewriteScopedJs(staged, [...names.keys()])
  let packed
  try {
    const raw = JSON.parse(npmPack(staged))
    // npm 11 packs as an array; npm 12 switched to an object keyed by the
    // package id. Accept both so the loop (and local runs) stay portable.
    packed = Array.isArray(raw) ? raw[0] : Object.values(raw)[0]
  } catch (error) {
    console.error(`pack failed: ${dir}`)
    console.error(error?.stderr ?? error?.message ?? error)
    process.exit(1)
  }
  const tarball = join(staged, packed.filename)
  cpSync(tarball, join(distNext, packed.filename))
  const shipped = shippedPaths(packed)
  tarballs.push({ name: packed.name, dir, file: packed.filename, size: packed.size, files: shipped.length, shipped })
  console.log(`${packed.name}  ${packed.size} bytes  ${shipped.length} files`)
}

const failures = []
for (const item of tarballs) {
  const staged = join(stagingNext, item.dir)
  const manifest = readJson(join(staged, 'package.json'))
  // F-356: validate the ACTUAL tarball contents (packed.files), not staging
  // disk — the `files` whitelist can exclude a bundle/chunk that exists on
  // disk, so a staging-disk check silently passes a tarball that ships a
  // broken module. Every entry point and every bundle import must exist in the
  // packed file list.
  const shipped = new Set(item.shipped)
  const inShipped = (rel) => shipped.has(rel.replace(/^\.\//, '').replace(/\\/g, '/'))
  if (typeof manifest.main === 'string' && !inShipped(manifest.main)) {
    failures.push(`${item.name}: packed ${manifest.main} is missing`)
  }
  if (typeof manifest.types === 'string' && !inShipped(manifest.types)) {
    failures.push(`${item.name}: packed ${manifest.types} (types) is missing`)
  }
  const libRoot = join(staged, 'lib')
  for (const rel of libBundles(libRoot)) {
    const text = readFileSync(join(libRoot, rel), 'utf8')
    for (const originalName of names.keys()) {
      if (text.includes(originalName)) {
        failures.push(`${item.name}: lib/${rel} still imports ${originalName} (unrewritten scope)`)
      }
    }
    for (const match of text.matchAll(/from\s+"(\.\/[^"]+\.js)"/g)) {
      const local = join(libRoot, match[1].slice(2))
      if (!inShipped(relative(staged, local).replace(/\\/g, '/'))) {
        failures.push(`${item.name}: lib/${rel} imports ${match[1]} which is missing from the tarball`)
      }
    }
  }
  for (const [name, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target === 'string' && !inShipped(target)) {
      failures.push(`${item.name}: export ${name} -> ${target} is missing from the tarball`)
    }
  }
}
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

// F-213 freshness credential: record exactly what this staging run was built
// for, so install-layered can refuse a stale `.release-staging` — the
// persistent dir has historically leaked old package code (0.3.1-test) into a
// new install. `.version` is the guard; `createdAt`/`gitSha` are provenance.
writeFileSync(join(stagingNext, '.staging-manifest.json'), JSON.stringify({
  version: releaseVersion,
  createdAt: new Date().toISOString(),
  gitSha: currentGitSha(),
}, null, 2) + '\n')

writeFileSync(join(distNext, 'manifest.json'), JSON.stringify(Object.fromEntries(tarballs.map(item => [item.name, item.file])), null, 2) + '\n')

const nameByDir = Object.fromEntries(tarballs.map(item => [item.dir, item.name]))
const publishGroups = [
  ['evolution-core'],
  ['evolution-io', 'evolution-state-storage'],
  ['evolution-io-node', 'evolution-state-domain', 'evolution-state-json'],
  ['evolution-state'],
  ['memory', 'memory-files', 'skill-usage'],
  ['evolution-policy', 'evolution-approval', 'evolution-threat'],
  ['evolution-plan-validator'],
  ['evolution-maintenance'],
  ['tool-memory', 'tool-skill-manage'],
  ['evolution-review', 'evolution-curator', 'evolution-commands'],
  ['evolution-activity', 'evolution-feedback', 'evolution-learning-graph', 'evolution-replay', 'evolution-skill-catalog', 'evolution-capability'],
  ['evolution-host', 'evolution-preset', 'evolution-agent', 'evolution-all'],
]
writeFileSync(join(distNext, 'publish-order.json'), JSON.stringify(publishGroups.map(group => group.map(dir => nameByDir[dir])), null, 2) + '\n')

const smokeDeps = {}
for (const item of tarballs) smokeDeps[item.name] = `file:${distRoot.split(String.fromCharCode(92)).join('/')}/${item.file}`
const ourNameSet = new Set(names.keys())
for (const name of externalNames) smokeDeps[name] = releaseSpec(name, ourNameSet, publishedVersions)
writeFileSync(join(distNext, 'smoke-package.json'), JSON.stringify({
  name: 'evo-release-smoke',
  private: true,
  version: '0.0.0',
  dependencies: smokeDeps,
}, null, 2) + '\n')

// Atomic swap: only now that the whole build (and its guard) passed do the
// live `.release-staging` and `dist` replace their `.next` siblings. A failed
// build never disturbs a previously good dist or a previously fresh staging.
rmSync(staging, { recursive: true, force: true })
renameSync(stagingNext, staging)
rmSync(distRoot, { recursive: true, force: true })
renameSync(distNext, distRoot)

console.log(`packed ${tarballs.length} packages -> ${distRoot}`)

