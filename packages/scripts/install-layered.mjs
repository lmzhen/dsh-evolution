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

import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const MODES = new Set(['host', 'agent', 'layered', 'oneclick'])
const EVOLUTION_PREFIXES = [
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
  all: `${EVOLUTION_SCOPE}/dsh-evolution-all`,
}
const STAGING_DIR = join(PACKAGES_DIR, '.release-staging')

function rootPackageVersion() {
  // The release version the current tree is building toward lives in the repo
  // root package.json (the mirror root carries the real 0.3.x). Walk up from
  // the package dir so both layout shapes (packages/scripts and the upstream
  // overlay packages/evolution/scripts) reach it.
  let dir = PACKAGES_DIR
  while (true) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      try {
        const version = JSON.parse(readFileSync(candidate, 'utf8')).version
        if (typeof version === 'string' && version) return version
      } catch {
        // fall through to the next ancestor
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return ''
    dir = parent
  }
}

function packageSourceRoot() {
  if (EVOLUTION_SCOPE === '@deepseek-ai') return PACKAGES_DIR
  if (existsSync(STAGING_DIR)) {
    // F-213: refuse a stale staging built for an older release. The persistent
    // .release-staging has historically leaked old package code (0.3.1-test)
    // into a new install, and the old check only tested that the dir exists.
    const manifestPath = join(STAGING_DIR, '.staging-manifest.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`scoped installer: ${STAGING_DIR} is not a fresh prepare-release staging — missing .staging-manifest.json; run prepare-release.mjs --scope ${EVOLUTION_SCOPE} to rebuild it`)
    }
    const stagingVersion = JSON.parse(readFileSync(manifestPath, 'utf8')).version
    const expected = rootPackageVersion()
    if (!expected || stagingVersion !== expected) {
      throw new Error(`scoped installer: ${STAGING_DIR} was built for ${stagingVersion || '(unknown)'} but this tree is ${expected || '(unknown)'} — the staging is stale; run prepare-release.mjs --scope ${EVOLUTION_SCOPE} to rebuild it`)
    }
    return STAGING_DIR
  }
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
      // Known boundary (R-08, recorded not changed): the `tests` prefix filter
      // is intentionally wider than `tests/` — a path whose first segment
      // merely STARTS WITH `tests` (e.g. `tests-support/`) would be excluded
      // too. No package in the family carries such a segment today; tighten
      // to an exact `tests` segment match only if one ever appears.
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
  if (!Array.isArray(bundles)) return false
  // V7-18 scope-agnostic match (same tail rule the mutual-exclusion check
  // uses): the profile may carry the bundle under @lmzhen while this script
  // defaults to the @deepseek-ai scope — an exact full-name filter misses it
  // and leaves the row behind (P1-2 removed everything but the all row).
  const tail = bundleName.slice(bundleName.lastIndexOf('/') + 1)
  const matched = bundles.filter(name => typeof name === 'string' && (name === bundleName || name.endsWith(`/${tail}`)))
  if (matched.length === 0) return false
  manifest.dsh.profile.bundles = bundles.filter(name => !matched.includes(name))
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return true
}

async function removeCopiedEvolutionPackages(profileDir, dryRun = false) {
  const scopeDir = join(profileDir, 'node_modules', EVOLUTION_SCOPE)
  if (!existsSync(scopeDir)) return 0
  let removed = 0
  for (const entry of await readdir(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!EVOLUTION_PREFIXES.some(prefix => entry.name.startsWith(prefix))) continue
    if (!dryRun) await rm(join(scopeDir, entry.name), { recursive: true, force: true })
    removed += 1
  }
  return removed
}

/**
 * Locate the `standard` agent preset composition at install time.
 *
 * Discovery order (rc.53 — the preset must follow the RUNTIME platform, not a
 * vendored baseline):
 *   1. `DSH_AGENT_PRESET_ROOT` (explicit, points at an agent-presets root);
 *   2. a nearby source tree (`apps/cli/config/agent-presets/...`) — the CI
 *      overlay layout and upstream dev checkouts both carry the real file;
 *   3. the globally installed `@deepseek-ai/dsh` (npm root -g).
 * Fails loud otherwise: a preset built from a guessed baseline would silently
 * mismatch the platform it runs on.
 */
async function resolveStandardComposition() {
  const standardName = join('standard', 'agent.cordis.yml')
  const direct = (root) => join(root, standardName)

  const explicit = process.env.DSH_AGENT_PRESET_ROOT?.trim()
  if (explicit) {
    const path = direct(explicit)
    if (!existsSync(path)) throw new Error(`DSH_AGENT_PRESET_ROOT is set but ${path} does not exist`)
    return await readFile(path, 'utf8')
  }

  // Walk upward from this script: mirror layout (packages/scripts) and the
  // upstream overlay layout (packages/evolution/scripts) both reach the tree
  // root within a few levels.
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  for (let level = scriptDir; level !== dirname(level); level = dirname(level)) {
    const path = direct(join(level, 'apps', 'cli', 'config', 'agent-presets'))
    if (existsSync(path)) return await readFile(path, 'utf8')
  }

  try {
    if (process.platform === 'win32') {
      // spawn of npm.cmd is blocked on Windows (EINVAL); the default global
      // module root is derivable from the standard APPDATA layout instead.
      const roots = [
        // V6-51 (0.3.37): an unset APPDATA produced `join('', …)` = a CWD-
        // relative path that existsSync resolved against the process cwd —
        // skip the empty candidate instead of probing a phantom.
        ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm', 'node_modules')] : []),
        join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
      ]
      for (const root of roots) {
        const path = direct(join(root, '@deepseek-ai', 'dsh', 'config', 'agent-presets'))
        if (existsSync(path)) return await readFile(path, 'utf8')
      }
    } else {
      // R-08 (V10): `npm` is a PATH executable on POSIX and the Windows branch
      // above never reaches this line, so spawn it shell-free like every other
      // child process in this script (shell: true re-introduced the injection
      // surface and quoting hazards the rest of the file deliberately avoids).
      const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
      const path = direct(join(globalRoot, '@deepseek-ai', 'dsh', 'config', 'agent-presets'))
      if (existsSync(path)) return await readFile(path, 'utf8')
    }
  } catch {
    // npm root -g is unavailable; fall through to the loud error below.
  }

  throw new Error(
    'install-layered: cannot find a runtime `standard` agent preset — install dsh first, '
    + 'set DSH_AGENT_PRESET_ROOT, or run from a source checkout containing apps/cli/config/agent-presets',
  )
}

/**
 * Row id set of a composition fragment — lightweight line parse, no YAML
 * library (v2 §10 scope control). Only `- id:` rows count; a row whose id
 * appears in BOTH fragments would mount twice in the generated composition.
 */
function rowIds(composition) {
  const ids = new Set()
  for (const line of composition.split('\n')) {
    const match = /^- id:\s*(\S+)/.exec(line)
    if (match) ids.add(match[1])
  }
  return ids
}

/**
 * Build the installed Evolution preset composition: the runtime platform's
 * `standard` rows verbatim, then the evolution delta. The delta stays the
 * only evolution-owned text, so the preset tracks every platform version.
 *
 * N-5 collision guard: an id present in BOTH fragments would mount twice
 * (worse, the duplicate could shadow the platform row). Fails loud; the
 * `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1` escape lets an upstream that absorbs
 * a delta row into standard transition (warn + keep both, mounting twice).
 */
export function generateAgentPreset(standardComposition, deltaComposition) {
  const standardIds = rowIds(standardComposition)
  const deltaIds = rowIds(deltaComposition)
  const collisions = [...deltaIds].filter(id => standardIds.has(id)).sort()
  if (collisions.length > 0 && process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS !== '1') {
    throw new Error(
      `install-layered: evolution delta rows collide with runtime standard rows: ${collisions.join(', ')}. `
      + 'Remove them from the delta, or set DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1 to keep both (the row will mount twice).',
    )
  }
  if (collisions.length > 0) {
    console.warn(`install-layered: warning — delta rows collide with standard rows (${collisions.join(', ')}); keeping both (DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1)`)
  }
  // V10-14 / 0.3.53 (P1-2): the cap injection is PART of the generation
  // contract — core composePresetComposition applies the byte-identical rule
  // (installer.spec pins the parity), so `/evolution preset install` and this
  // source installer can never diverge on the preset-scope tool-skill cap.
  return injectToolSkillCap(`${standardComposition.replace(/\s+$/, '')}\n\n${deltaComposition.trim()}\n`)
}

/**
 * V10-14 (P1-2): inject the Hermes 60-char catalog cap onto the STANDARD
 * sourced `- id: tool-skill` row of the composed preset.
 *
 * The session-visible `tool-skill` instance mounts in the agent preset's own
 * standing scope; a profile-root patch (evolution-host/cordis.patch.yml)
 * cannot reach it, so before this injection the layered install ran the
 * platform default (500) on the catalog's read side. Text-level rewrite in
 * the same line-scan style as rowIds() above (no YAML library — v2 §10 scope
 * control). 0.3.53: generateAgentPreset now calls this internally; core
 * composePresetComposition ships the byte-identical rule (installer.spec
 * pins the parity), so the npm `/evolution preset install` path applies it too:
 *   - idempotent: a tool-skill item that already carries a `config:` key is
 *     left byte-identical, so re-running the installer never doubles the key;
 *   - the injected block carries a marker comment so a diff of the generated
 *     preset can tell installer-owned text from platform text;
 *   - a composition WITHOUT a tool-skill row is returned unchanged with a
 *     one-time warning (a renamed platform row must not brick the install,
 *     but the missed cap must be observable).
 */
export function injectToolSkillCap(composition) {
  const lines = composition.split('\n')
  let found = false
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^- id:\s*tool-skill\s*$/.test(lines[i] ?? '')) continue
    found = true
    // Walk the item's continuation lines (indented) up to the next item or
    // top-level line; a blank line terminates the item block.
    let end = i
    let hasConfig = false
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? ''
      if (next.trim() === '') break
      if (!/^\s/.test(next)) break
      if (/^\s+config:(\s|$)/.test(next)) hasConfig = true
      end = j
    }
    if (hasConfig) continue
    lines.splice(end + 1, 0,
      '  # V10-14: Hermes 60-char catalog cap — injected by the preset composer (P1-2);',
      '  # this preset-scope row is the session-visible instance and no profile',
      '  # patch can reach it. Remove only to run the platform default (500).',
      '  config:',
      '    catalogDescriptionMaxLength: 60',
    )
    i = end + 5
  }
  if (!found) {
    console.warn('install-layered: warning — no `- id: tool-skill` row in the composed preset; the 60-char catalog cap was NOT injected (platform renamed the row? reconcile with the delta)')
  }
  return lines.join('\n')
}

async function installAgentPreset(home, dryRun, force) {
  const destination = agentPresetDirectory(home)
  // The generated composition always resolves, also in dry-run: a preset that
  // cannot be built from the runtime platform should be reported up front.
  const standardComposition = await resolveStandardComposition()
  // DSH_EVOLUTION_DELTA_PATH lets tests (and one-off builds) inject the delta
  // fragment; the packaged evolution-agent/agent.cordis.yml stays the default.
  const deltaPath = process.env.DSH_EVOLUTION_DELTA_PATH?.trim() || join(packageSourceRoot(), 'evolution-agent', 'agent.cordis.yml')
  const deltaComposition = await readFile(deltaPath, 'utf8')
  // V10-14 (P1-2): the cap injection runs INSIDE generateAgentPreset (on the
  // COMPOSED output, after the collision guard) — core composePresetComposition
  // applies the byte-identical rule, and installer.spec pins the parity.
  const composition = generateAgentPreset(standardComposition, deltaComposition)
  // The `exists && !force` result must be reported identically in dry-run and
  // real mode — a dry-run always claiming installed:true hides an already
  // present preset (F-354). Only the write is skipped in dry-run.
  if (existsSync(destination) && !force) {
    return { destination, installed: false, reason: 'exists; use --force to overwrite' }
  }
  if (!dryRun) {
    await mkdir(destination, { recursive: true })
    // Atomic write (F-354): a crash mid-write must not leave a truncated
    // agent.cordis.yml for the loader to parse.
    const tmp = join(destination, 'agent.cordis.yml.tmp')
    await writeFile(tmp, composition)
    await rename(tmp, join(destination, 'agent.cordis.yml'))
    // R-08 (V10): preset.yml gets the SAME tmp+rename atomic write as
    // agent.cordis.yml above — F-354 previously protected only half of the
    // transaction, so a crash could leave a truncated preset.yml behind.
    const presetTmp = join(destination, 'preset.yml.tmp')
    await writeFile(presetTmp, await readFile(join(packageSourceRoot(), 'evolution-agent', 'preset.yml')))
    await rename(presetTmp, join(destination, 'preset.yml'))
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
    // P1-2 (v11): evolution-all is a DEFAULT install target — uninstall must
    // remove its bundle row symmetrically, or the leftover row resolves a
    // package that was just deleted and bricks the profile.
    if (!dryRun) await removeBundleFromProfile(profileDir, BUNDLES.all)
    result.removedPackages = await removeCopiedEvolutionPackages(profileDir, dryRun)
  }
  if (mode === 'agent' || mode === 'layered') {
    // P2-42 (v11): report the real outcome — dry-run or an absent preset
    // directory does not mean "deleted".
    const presetDir = agentPresetDirectory(home)
    if (!dryRun && existsSync(presetDir)) {
      await rm(presetDir, { recursive: true, force: true })
      result.removedAgentPreset = true
    }
  }
  return result
}

/**
 * 0.3.54 (route B): is the target profile already carrying an evolution-all
 * bundle row? The full bundle and the layered Evolution preset are exclusive
 * on the model rows — returning the matched bundle names lets the installer
 * refuse up front with the choose-one guidance instead of the user reaching
 * the startup double-mount error.
 */
export function detectInstalledAllBundle(profileDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const bundles = manifest?.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter(name => /evolution-all/.test(String(name))) : []
  } catch {
    return []
  }
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

  // 0.3.54 (route B): the full bundle mounts the SAME model rows at profile
  // root — generating the layered preset on top would double-mount them
  // (startup fail-loud). Refuse with the choose-one guidance instead of
  // letting the user reach that error.
  if (needsAgent) {
    const allBundles = detectInstalledAllBundle(profileDir)
    if (allBundles.length > 0) {
      throw new Error(
        `install-layered: the profile already carries an evolution-all bundle (${allBundles.join(', ')}). `
        + 'evolution-all is the DEFAULT full-functionality install and already mounts the model tools at profile root — '
        + 'the layered Evolution preset would double-mount them. Choose ONE: keep evolution-all (no preset), '
        + 'or switch the profile to evolution-host and generate the preset.',
      )
    }
  }

  if (needsHost || needsCompat) {
    const bundleName = needsHost ? BUNDLES.host : BUNDLES.oneclick
    // P1-3 (v11): evolution-all is the DEFAULT full bundle — installing host
    // or oneclick on top must refuse like host⇄preset does (the all patch
    // double-mounts the infra rows, startup fail-loud).
    const installedAll = detectInstalledAllBundle(profileDir)
    if (!dryRun && installedAll.length > 0) {
      throw new Error(
        `install-layered: profile "${profile}" already carries an evolution-all bundle (${installedAll.join(', ')}). `
        + 'evolution-all is the DEFAULT full-functionality install — host/preset would double-mount its infra rows. '
        + 'Uninstall all first (or keep it and skip this installer).',
      )
    }
    // V6-49 (0.3.37): E-33 — the host bundle and the preset bundle are
    // mutually exclusive install targets (their shared rows would double-mount
    // in one profile). A documented warning was not enforcement: the tool
    // itself could turn the documented accident into reality. Fail loud when
    // the other bundle is already present. DSH_EVOLUTION_ALLOW_ROW_COLLISIONS
    // does not exempt this check (mutual exclusion is install-surface
    // semantics, not a row collision). Dry-run reads a phantom profile path —
    // there is no real state to check.
    if (!dryRun) {
      const manifestPath = join(profileDir, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        const existing = Array.isArray(manifest.dsh?.profile?.bundles)
          ? manifest.dsh.profile.bundles
          : []
        const other = bundleName === BUNDLES.host ? BUNDLES.oneclick : BUNDLES.host
        // V7-18 (0.3.44): the comparison was an exact full-name includes — a
        // profile that carries `@lmzhen/dsh-evolution-preset` slipped past the
        // check when installing the host with the default `@deepseek-ai` scope
        // (E-33 double mount). Match the package TAIL (scope-agnostic).
        const otherTail = other.slice(other.lastIndexOf('/') + 1)
        const conflict = existing.some(entry => typeof entry === 'string' && (entry === other || entry.endsWith(`/${otherTail}`)))
        if (conflict) {
          throw new Error(
            `install-layered: profile "${profile}" already carries the ${other} bundle — host and preset are mutually exclusive install targets (E-33). Uninstall it first or use dsh plugin add. DSH_EVOLUTION_ALLOW_ROW_COLLISIONS does not exempt this check.`,
          )
        }
      }
    }
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
      // R-08 (V10): this block was left at column 4 by a merge (the uninstall
      // branch above indents correctly) — realign with the surrounding try.
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
