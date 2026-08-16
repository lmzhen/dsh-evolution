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

import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const MODES = new Set(['host', 'agent', 'layered', 'oneclick'])
const PACKAGES_DIR = fileURLToPath(new URL('../', import.meta.url))
const EVOLUTION_SCOPE = '@deepseek-ai'
const BUNDLES = {
  host: '@deepseek-ai/dsh-evolution-host',
  oneclick: '@deepseek-ai/dsh-evolution-preset',
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
        && base !== 'lib'
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
  for (const entry of await readdir(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(PACKAGES_DIR, entry.name)
    if (!existsSync(join(source, 'package.json'))) continue
    const packageName = await readPackageName(source)
    const destination = join(profileDir, 'node_modules', EVOLUTION_SCOPE, scopedName(packageName))
    copies.push({ packageName, source, destination })
    if (!dryRun) await copyPackage(source, destination)
  }
  return copies
}

async function installAgentPreset(home, dryRun, force) {
  const destination = agentPresetDirectory(home)
  if (!dryRun) {
    if (existsSync(destination) && !force) {
      return { destination, installed: false, reason: 'exists; use --force to overwrite' }
    }
    await mkdir(destination, { recursive: true })
    for (const file of ['agent.cordis.yml', 'preset.yml']) {
      await cp(join(PACKAGES_DIR, 'evolution-agent', file), join(destination, file), { force })
    }
  }
  return { destination, installed: true }
}

export async function install(options = {}) {
  const mode = options.mode ?? 'layered'
  if (!MODES.has(mode)) throw new Error(`unknown mode ${mode}; expected one of ${[...MODES].join(', ')}`)
  const home = options.home ?? resolveHome(options.env)
  const profile = options.profile ?? 'web'
  const dryRun = options.dryRun === true
  const force = options.force === true
  const profileDir = dryRun ? profileDirectory(home, profile) : await ensureProfile(home, profile)
  const result = { mode, home, profile, profileDir, copied: [], bundle: null, agentPreset: null }

  const needsHost = mode === 'host' || mode === 'layered'
  const needsAgent = mode === 'agent' || mode === 'layered'
  const needsCompat = mode === 'oneclick'

  if (needsHost || needsCompat) {
    const bundleName = needsHost ? BUNDLES.host : BUNDLES.oneclick
    result.bundle = bundleName
    result.copied = await copyAllEvolutionPackages(profileDir, dryRun)
    if (!dryRun) await installBundlePackage(profileDir, bundleName)
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
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = await install(options)
    console.log(`mode:     ${result.mode}`)
    console.log(`profile:  ${result.profile} (${result.profileDir})`)
    if (result.bundle) console.log(`bundle:   ${result.bundle}`)
    console.log(`copied:   ${result.copied.length} evolution packages`)
    if (result.agentPreset) {
      console.log(`preset:   ${result.agentPreset.destination}${result.agentPreset.installed ? '' : ` (${result.agentPreset.reason})`}`)
    }
    if (options.dryRun) console.log('dry-run:  no files were written')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
