#!/usr/bin/env node
/**
 * One-click local installer for the layered dsh-evolution installation.
 *
 * Modes:
 *   host     install @deepseek-ai/dsh-evolution-host as a profile bundle
 *   agent    install the Evolution agent preset under $DSH_HOME/.agent-presets/evolution
 *   layered  host + agent
 *   oneclick install the compatibility @deepseek-ai/dsh-evolution-preset bundle
 *
 * This installer targets DSH source/debug layouts: it copies the evolution
 * packages into the profile's node_modules and writes the profile manifest.
 * For a production install, prefer `dsh plugin add` against the published
 * bundle package.
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const MODES = new Set(['host', 'agent', 'layered', 'oneclick'])
const EVOLUTION_PREFIXES = [
  'dsh-evolution',
  'dsh-evolution-',
  'dsh-memory',
  'dsh-memory-files',
  'dsh-skill-usage',
  'dsh-tool-memory',
  'dsh-tool-skill-manage',
]
const PACKAGES_DIR = fileURLToPath(new URL('../', import.meta.url))
const EVOLUTION_SCOPE = process.env.EVOLUTION_SCOPE?.trim() || '@deepseek-ai'
const BUNDLES = {
  host: `${EVOLUTION_SCOPE}/dsh-evolution-host`,
  oneclick: `${EVOLUTION_SCOPE}/dsh-evolution-preset`,
}
const STAGING_DIR = join(PACKAGES_DIR, '.release-staging')

function packageSourceRoot() {
  if (EVOLUTION_SCOPE === '@deepseek-ai') return PACKAGES_DIR
  if (existsSync(STAGING_DIR)) return STAGING_DIR
  throw new Error(`scoped installer requires ${STAGING_DIR}; run prepare-release.mjs --scope ${EVOLUTION_SCOPE} first`)
}

export function resolveHome(env = process.env) {
  return env.DSH_HOME?.trim() ? resolve(env.DSH_HOME) : join(homedir(), '.dsh')
}

export function profileDirectory(home, profile) {
  return join(home, 'profiles', profile)
}

export function agentPresetDirectory(home) {
  return join(home, '.agent-presets', 'evolution')
}

function scopedName(packageName) {
  return packageName.startsWith(`${EVOLUTION_SCOPE}/`)
    ? packageName.slice(EVOLUTION_SCOPE.length + 1)
    : packageName
}

async function readPackageName(packageDir) {
  const raw = await readFile(join(packageDir, 'package.json'), 'utf8')
  return JSON.parse(raw).name
}

async function copyPackage(source, destination) {
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      const base = sourcePath.slice(source.length + 1)
      return base !== 'node_modules'
        && !base.startsWith('tests')
        && !base.endsWith('.tsbuildinfo')
    },
  })
}

async function ensureProfile(home, profile) {
  const dir = profileDirectory(home, profile)
  await mkdir(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    await writeFile(manifestPath, JSON.stringify({
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [] } },
    }, null, 2) + '\n')
  }
  const patchPath = join(dir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) await writeFile(patchPath, '[]\n')
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) {
    await writeFile(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  }
  return dir
}

async function installBundlePackage(profileDir, bundleName) {
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  manifest.dsh ??= {}
  manifest.dsh.profile ??= { bundles: [] }
  const bundles = Array.isArray(manifest.dsh.profile.bundles)
    ? manifest.dsh.profile.bundles
    : []
  if (!bundles.includes(bundleName)) bundles.push(bundleName)
  manifest.dsh.profile.bundles = bundles
  await writeFile(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
}

async function copyAllEvolutionPackages(profileDir, dryRun) {
  const copies = []
  const sourceRoot = packageSourceRoot()
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(sourceRoot, entry.name)
    if (!existsSync(join(source, 'package.json'))) continue
    const packageName = await readPackageName(source)
    const destination = join(profileDir, 'node_modules', EVOLUTION_SCOPE, scopedName(packageName))
    copies.push({ packageName, source, destination })
    if (!dryRun) await copyPackage(source, destination)
  }
  return copies
}

/** A source-tree install is only directly runnable when lib/index.js exists. */
function missingEntrypoints(copies) {
  return copies.filter(({ packageName, source, destination }) => {
    const manifestPath = existsSync(join(destination, 'package.json'))
      ? join(destination, 'package.json')
      : join(source, 'package.json')
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const main = typeof manifest.main === 'string' ? manifest.main : ''
      if (!main.endsWith('.js')) return false
      return !existsSync(join(destination, main)) && !existsSync(join(source, main))
    } catch {
      return false
    }
  }).map(({ packageName }) => packageName)
}

async function removeBundleFromProfile(profileDir, bundleName) {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return false
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes(bundleName)) return false
  manifest.dsh.profile.bundles = bundles.filter(name => name !== bundleName)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return true
}

async function removeCopiedEvolutionPackages(profileDir) {
  const scopeDir = join(profileDir, 'node_modules', EVOLUTION_SCOPE)
  if (!existsSync(scopeDir)) return 0
  let removed = 0
  for (const entry of await readdir(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!EVOLUTION_PREFIXES.some(prefix => entry.name === prefix || entry.name.startsWith(`${prefix}`))) continue
    await rm(join(scopeDir, entry.name), { recursive: true, force: true })
    removed += 1
  }
  return removed
}

async function installAgentPreset(home, dryRun, force) {
  const destination = agentPresetDirectory(home)
  if (!dryRun) {
    if (existsSync(destination) && !force) {
      return { destination, installed: false, reason: 'exists; use --force to overwrite' }
    }
    await mkdir(destination, { recursive: true })
    for (const file of ['agent.cordis.yml', 'preset.yml']) {
      await cp(join(packageSourceRoot(), 'evolution-agent', file), join(destination, file), { force })
    }
  }
  return { destination, installed: true }
}

export async function uninstall(options = {}) {
  const mode = options.mode ?? 'layered'
  if (!MODES.has(mode)) throw new Error(`unknown mode ${mode}; expected one of ${[...MODES].join(', ')}`)
  const home = options.home ?? resolveHome(options.env)
  const profile = options.profile ?? 'web'
  const dryRun = options.dryRun === true
  const profileDir = profileDirectory(home, profile)
  const result = { mode, home, profile, profileDir, removedBundle: null, removedPackages: 0, removedAgentPreset: false }

  if (mode === 'host' || mode === 'layered' || mode === 'oneclick') {
    const bundleName = mode === 'oneclick' ? BUNDLES.oneclick : BUNDLES.host
    result.removedBundle = bundleName
    if (!dryRun) await removeBundleFromProfile(profileDir, bundleName)
    result.removedPackages = dryRun ? EVOLUTION_PREFIXES.length : await removeCopiedEvolutionPackages(profileDir)
  }
  if (mode === 'agent' || mode === 'layered') {
    result.removedAgentPreset = true
    if (!dryRun) await rm(agentPresetDirectory(home), { recursive: true, force: true })
  }
  return result
}

export async function install(options = {}) {
  const mode = options.mode ?? 'layered'
  if (!MODES.has(mode)) throw new Error(`unknown mode ${mode}; expected one of ${[...MODES].join(', ')}`)
  const home = options.home ?? resolveHome(options.env)
  const profile = options.profile ?? 'web'
  const dryRun = options.dryRun === true
  const force = options.force === true
  const profileDir = dryRun ? profileDirectory(home, profile) : await ensureProfile(home, profile)
  const result = { mode, home, profile, profileDir, copied: [], missingEntrypoints: [], bundle: null, agentPreset: null }

  const needsHost = mode === 'host' || mode === 'layered'
  const needsAgent = mode === 'agent' || mode === 'layered'
  const needsCompat = mode === 'oneclick'

  if (needsHost || needsCompat) {
    const bundleName = needsHost ? BUNDLES.host : BUNDLES.oneclick
    result.bundle = bundleName
    result.copied = await copyAllEvolutionPackages(profileDir, dryRun)
    if (!dryRun) await installBundlePackage(profileDir, bundleName)
    result.missingEntrypoints = missingEntrypoints(result.copied)
  }

  if (needsAgent) {
    result.agentPreset = await installAgentPreset(home, dryRun, force)
  }

  return result
}

function parseArgs(argv) {
  const options = { mode: 'layered', profile: 'web' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--mode') options.mode = argv[++i]
    else if (arg === '--profile') options.profile = argv[++i]
    else if (arg === '--home') options.home = resolve(argv[++i])
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--uninstall') options.uninstall = true
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.uninstall) {
      const result = await uninstall(options)
      console.log(`uninstall mode:     ${result.mode}`)
      console.log(`profile:  ${result.profile} (${result.profileDir})`)
      if (result.removedBundle) console.log(`bundle:   ${result.removedBundle}`)
      console.log(`packages: ${result.removedPackages}`)
      console.log(`preset:   ${result.removedAgentPreset}`)
      if (options.dryRun) console.log('dry-run:  no files were written')
    } else {
      const result = await install(options)
    console.log(`scope:    ${EVOLUTION_SCOPE}`)
    console.log(`mode:     ${result.mode}`)
    console.log(`profile:  ${result.profile} (${result.profileDir})`)
    if (result.bundle) console.log(`bundle:   ${result.bundle}`)
    console.log(`copied:   ${result.copied.length} evolution packages`)
    if (result.missingEntrypoints.length > 0) {
      console.log(`unbuilt:  ${result.missingEntrypoints.length} packages lack lib/index.js — build them first, or boot the profile with a TS loader`)
    }
    if (result.agentPreset) {
      console.log(`preset:   ${result.agentPreset.destination}${result.agentPreset.installed ? '' : ` (${result.agentPreset.reason})`}`)
    }
      if (options.dryRun) console.log('dry-run:  no files were written')
    }
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
