#!/usr/bin/env node
/**
 * Publish preparation for the evolution package family.
 *
 * Packs every package from a pristine copy with publish-ready manifests:
 *   - workspace:^ is converted to real semver ranges
 *   - --scope renames our packages, YAML rows, repository metadata and
 *     removes unpublished ./src/* export shims
 *   - --version and --upstream-version pin the release and upstream family
 *   - tarballs are validated before manifest/smoke artifacts are written
 *
 * Usage:
 *   node packages/evolution/scripts/build-lib.mjs
 *   node packages/evolution/scripts/prepare-release.mjs
 *   node packages/evolution/scripts/prepare-release.mjs \
 *     --scope @lmzhen --version 0.1.0-rc.1 --upstream-version 0.1.0-rc.6
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evolutionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(evolutionRoot, '../..')
const distRoot = join(evolutionRoot, 'dist')
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

const scope = arg('--scope')
const releaseVersion = arg('--version', '0.1.0-rc.1')
const upstreamVersion = arg('--upstream-version', '0.1.0-rc.6')

/**
 * Packages kept in the tree as source of record but retired from npm
 * publishing. The legacy `dsh-evolution` facade was deleted at rc.18
 * (superseded by the host bundle + Evolution agent preset).
 */
const PUBLISH_EXCLUDE = new Set<string>()

const sourceDirs = readdirSync(evolutionRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(evolutionRoot, entry.name, 'package.json')))
  .map(entry => entry.name)
  .filter(dir => !PUBLISH_EXCLUDE.has(dir))
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

function scopedPackageName(name) {
  return scope ? `${scope}/${name.slice('@deepseek-ai/'.length)}` : name
}

function releaseSpec(name, ourNames, publishedVersions) {
  if (ourNames.has(name)) return `^${releaseVersion}`
  if (name === '@deepseek-ai/cordis') return '^4.0.1'
  if (name === '@deepseek-ai/schemastery') return '^3.18.1'
  if (name.startsWith('@deepseek-ai/dsh-')) return `^${upstreamVersion}`
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
      else if (entry.isFile() && path.endsWith('.js')) {
        writeFileSync(path, rewriteScopedText(readFileSync(path, 'utf8'), names))
      }
    }
  }
}

rmSync(distRoot, { recursive: true, force: true })
mkdirSync(distRoot, { recursive: true })
const staging = join(evolutionRoot, '.release-staging')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

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
  const staged = join(staging, dir)
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
  rewriteScopedJs(staged, names.keys())
  let packed
  try {
    packed = JSON.parse(npmPack(staged))[0]
  } catch (error) {
    console.error(`pack failed: ${dir}`)
    console.error(error?.stderr ?? error?.message ?? error)
    process.exit(1)
  }
  const tarball = join(staged, packed.filename)
  cpSync(tarball, join(distRoot, packed.filename))
  tarballs.push({ name: packed.name, dir, file: packed.filename, size: packed.size, files: packed.files.length })
  console.log(`${packed.name}  ${packed.size} bytes  ${packed.files.length} files`)
}

const failures = []
for (const item of tarballs) {
  const staged = join(staging, item.dir)
  const manifest = readJson(join(staged, 'package.json'))
  if (typeof manifest.main === 'string' && !existsSync(join(staged, manifest.main))) {
    failures.push(`${item.name}: packed ${manifest.main} is missing`)
  }
  const entry = join(staged, 'lib', 'index.js')
  if (existsSync(entry)) {
    const entryText = readFileSync(entry, 'utf8')
    for (const originalName of names.keys()) {
      if (entryText.includes(originalName)) {
        failures.push(`${item.name}: lib/index.js still imports ${originalName}`)
      }
    }
  }
  for (const [name, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target === 'string' && !existsSync(join(staged, target))) {
      failures.push(`${item.name}: export ${name} -> ${target} is missing from the tarball`)
    }
  }
}
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

writeFileSync(join(distRoot, 'manifest.json'), JSON.stringify(Object.fromEntries(tarballs.map(item => [item.name, item.file])), null, 2) + '\n')

const nameByDir = Object.fromEntries(tarballs.map(item => [item.dir, item.name]))
const publishGroups = [
  ['evolution-core'],
  ['evolution-io', 'evolution-state-storage'],
  ['evolution-io-node', 'evolution-state-domain', 'evolution-state-json'],
  ['evolution-state'],
  ['memory', 'memory-files', 'skill-usage'],
  ['evolution-policy', 'evolution-approval', 'evolution-threat'],
  ['evolution-plan-validator'],
  ['tool-memory', 'tool-skill-manage'],
  ['evolution-review', 'evolution-curator', 'evolution-commands'],
  ['evolution-activity', 'evolution-feedback', 'evolution-learning-graph', 'evolution-replay', 'evolution-skill-catalog', 'evolution-capability'],
  ['evolution-host', 'evolution-preset', 'evolution-agent'],
]
writeFileSync(join(distRoot, 'publish-order.json'), JSON.stringify(publishGroups.map(group => group.map(dir => nameByDir[dir])), null, 2) + '\n')

const smokeDeps = {}
for (const item of tarballs) smokeDeps[item.name] = `file:${distRoot.split(String.fromCharCode(92)).join('/')}/${item.file}`
const ourNameSet = new Set(names.keys())
for (const name of externalNames) smokeDeps[name] = releaseSpec(name, ourNameSet, publishedVersions)
writeFileSync(join(distRoot, 'smoke-package.json'), JSON.stringify({
  name: 'evo-release-smoke',
  private: true,
  version: '0.0.0',
  dependencies: smokeDeps,
}, null, 2) + '\n')

console.log(`packed ${tarballs.length} packages -> ${distRoot}`)

