#!/usr/bin/env node
/**
 * Publish preparation for the evolution package family.
 *
 * Packs every package from a pristine copy with publish-ready manifests:
 *   - workspace:^ is converted to real semver ranges
 *   - optional --scope renames our packages to a personal npm scope
 *   - package tarballs are validated for missing entrypoints and leftover
 *     source-subpath imports before they are written to packages/evolution/dist
 *
 * Usage:
 *   node packages/evolution/scripts/build-lib.mjs
 *   node packages/evolution/scripts/prepare-release.mjs
 *   node packages/evolution/scripts/prepare-release.mjs --scope @lmzhen
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evolutionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(evolutionRoot, '../..')
const distRoot = join(evolutionRoot, 'dist')
const argv = process.argv.slice(2)
const scopeIndex = argv.indexOf('--scope')
const scope = scopeIndex >= 0 ? argv[scopeIndex + 1] : ''
const releaseVersion = '0.1.0-rc.1'

const sourceDirs = readdirSync(evolutionRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(evolutionRoot, entry.name, 'package.json')))
  .map(entry => entry.name)
  .sort()

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function run(command, args, cwd) {
  const result = spawnSync(process.execPath, [command, ...args], { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
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
    return execFileSync(command[0], command[1], { encoding: 'utf8' }).trim().split(String.fromCharCode(10)).pop()




  } catch {
    return ''
  }
}

function releaseSpec(name, ourNames, publishedVersions) {
  if (ourNames.has(name)) return `^${releaseVersion}`
  const published = publishedVersions[name]
  if (published) return published.startsWith('^') ? published : `^${published}`
  if (name === '@deepseek-ai/cordis') return '^4.0.1'
  if (name === '@deepseek-ai/schemastery') return '^3.18.1'
  if (name.startsWith('@deepseek-ai/dsh-')) return '^0.0.1-rc.1'
  return `^${releaseVersion}`
}

function rewritePackage(pkg, ourNames, publishedVersions) {
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      let rewritten = name
      if (scope && ourNames.has(name)) rewritten = `${scope}/${name.slice('@deepseek-ai/'.length)}`
      if (spec === 'workspace:^') pkg[section][name] = releaseSpec(name, ourNames, publishedVersions)
      if (rewritten !== name) {
        pkg[section][rewritten] = pkg[section][name]
        delete pkg[section][name]
      }
    }
  }
  if (scope) pkg.name = `${scope}/${pkg.name.slice('@deepseek-ai/'.length)}`
  if (scope) pkg.repository.url = 'git+https://github.com/lmzhen/dsh-evolution.git'
  return pkg
}

function validateTarball(tarball) {
  const listing = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json'], { cwd: dirname(tarball), encoding: 'utf8' })
  if (listing.status !== 0) return listing.stderr
  const parsed = JSON.parse(listing.stdout)
  const files = parsed[0].files.map(file => file.path)
  const failures = []
  for (const file of files) {
    if (!file.startsWith('lib/')) continue
    if (file.endsWith('.js')) {
      const text = readFileSync(join(dirname(tarball), file), 'utf8')
      if (text.includes('@deepseek-ai/dsh-evolution/src/')) {
        failures.push(`${file} still imports a dsh-evolution source subpath`)
      }
    }
  }
  return failures
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

writeFileSync(join(distRoot, 'manifest.json'), JSON.stringify(Object.fromEntries(tarballs.map(item => [item.name, item.file])), null, 2) + '\n')

const smokeDeps = {}
for (const item of tarballs) smokeDeps[item.name] = `file:${distRoot.split(String.fromCharCode(92)).join('/')}/${item.file}`
for (const [name, version] of Object.entries(publishedVersions)) {
  if (version) smokeDeps[name] = version.startsWith('^') ? version : `^${version}`
}
writeFileSync(join(distRoot, 'smoke-package.json'), JSON.stringify({
  name: 'evo-release-smoke',
  private: true,
  version: '0.0.0',
  dependencies: smokeDeps,
}, null, 2) + '\n')





const failures = []
for (const item of tarballs) {
  const staged = join(staging, item.dir)
  const manifest = readJson(join(staged, 'package.json'))
  if (typeof manifest.main === 'string' && !existsSync(join(staged, manifest.main))) {
    failures.push(`${item.name}: packed ${manifest.main} is missing`)
  }
  const entry = join(staged, 'lib', 'index.js')
  if (existsSync(entry) && readFileSync(entry, 'utf8').includes('@deepseek-ai/dsh-evolution/src/')) {
    failures.push(`${item.name}: lib/index.js still imports a dsh-evolution source subpath`)
  }
}
console.log(`packed ${tarballs.length} packages -> ${distRoot}`)
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
