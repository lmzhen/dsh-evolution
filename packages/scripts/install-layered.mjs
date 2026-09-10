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
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

/** P2-22 (v19): the version to pin is the FAMILY's. The ancestor walk below
 * reaches the HOST repo's root package.json in an overlay/dev checkout (0.1.x)
 * and pinned the bundle to a range that has nothing to do with the family; the
 * bundle package's own manifest is the authority. The ancestor walk stays as a
 * fallback for trees that ship no bundle source. */
function familyVersion() {
  try {
    const version = JSON.parse(readFileSync(join(packageSourceRoot(), 'evolution-host', 'package.json'), 'utf8')).version
    if (typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version)) return version
  } catch {
    // fall through to the ancestor walk
  }
  return rootPackageVersion()
}

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
  // v21 (D-5): trim the value we RESOLVE — the old form tested `trim()` but
  // returned the raw value (core fixed the identical V8-06/C-11 shape in
  // state-store.ts), so `DSH_HOME=" /x "` persisted with literal spaces, and
  // the extra resolve() expanded relative paths against the INSTALLER's CWD
  // instead of the runtime's — packages landed in a home tree the plugins
  // never read.
  const home = env.DSH_HOME?.trim()
  return home ? resolve(home) : join(homedir(), '.dsh')
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

/** D-4 (v18): upstream `initProfile` seeds a named profile with its template
 * bundles. The hand-rolled copy seeded an EMPTY list, so a profile the
 * installer created itself lacked the platform base/web-app rows. Platform
 * packages are always `@deepseek-ai`-scoped (only the family packages are
 * scope-rewritten at publish). */
const PROFILE_SEED_BUNDLES = {
  web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
}
const DEFAULT_SEED_BUNDLES = ['@deepseek-ai/dsh-base']

async function ensureProfile(home, profile) {
  const dir = profileDirectory(home, profile)
  await mkdir(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    await writeFile(manifestPath, JSON.stringify({
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {},
      dsh: {
        profile: {
          bundles: [...(Object.prototype.hasOwnProperty.call(PROFILE_SEED_BUNDLES, profile)
            ? PROFILE_SEED_BUNDLES[profile]
            : DEFAULT_SEED_BUNDLES)],
        },
      },
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
  // D-3 (v18): a mounted bundle row MUST also be pinned in `dependencies`
  // (the repo's own verify-profile-bundles guard treats a row without a
  // dependency as a phantom row, and a later pnpm install would prune the
  // hand-copied packages). P2-22 (v19): the range comes from the family.
  const version = familyVersion()
  manifest.dependencies ??= {}
  const addedDependency = !Object.prototype.hasOwnProperty.call(manifest.dependencies, bundleName)
  manifest.dependencies[bundleName] = /^\d+\.\d+\.\d+/.test(version) ? `^${version}` : '*'
  await writeFile(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { addedDependency, dependencyRange: manifest.dependencies[bundleName] }
}

/** P1-3 (v19): the install journal. Every profile-level write the installer
 * makes (bundle row, dependency row, copied packages, agent preset) is
 * recorded here so uninstall can replay it in reverse instead of guessing.
 * Absent for installs made by 0.3.64 and earlier — uninstall falls back to the
 * name-based rules for those. */
const INSTALL_JOURNAL = '.evolution-install.json'

async function writeInstallJournal(profileDir, journal) {
  await writeFile(join(profileDir, INSTALL_JOURNAL), JSON.stringify(journal, null, 2) + '\n')
}

async function readInstallJournal(profileDir) {
  try {
    return JSON.parse(await readFile(join(profileDir, INSTALL_JOURNAL), 'utf8'))
  } catch {
    return null
  }
}

async function copyAllEvolutionPackages(profileDir, dryRun) {
  const copies = []
  const sourceRoot = packageSourceRoot()
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(sourceRoot, entry.name)
    if (!existsSync(join(source, 'package.json'))) continue
    const packageName = await readPackageName(source)
    // D-18 (v18): install and uninstall must use the SAME package set. The
    // uninstall side filters the SCOPED package directory name; install used
    // to copy any directory carrying a package.json. (Compare the scope-less
    // name: source manifests are `@deepseek-ai/dsh-evolution-*`, destination
    // directories are `dsh-evolution-*`.)
    if (!EVOLUTION_PREFIXES.some(prefix => scopedName(packageName).startsWith(prefix))) continue
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

async function removeBundleFromProfile(profileDir, bundleName, options = {}) {
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
  // P1-3 (v19): the D-3 dependency row must go with the bundle row. Leaving it
  // behind pointed the profile at a package that is deleted right after, so
  // the next `dsh plugin add` / `pnpm install` in that profile failed E404.
  // v21 (S-1): when the install journal proves the installer did NOT add this
  // dependency (the user had pinned it before), keep the user's row — the
  // journal-less fallback (≤0.3.64) keeps the unconditional removal.
  const keepDependency = options.keepDependency === true
  if (!keepDependency) {
    const dependencies = manifest.dependencies
    if (dependencies !== null && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      for (const key of Object.keys(dependencies)) {
        if (key === bundleName || key.endsWith(`/${tail}`)) delete dependencies[key]
      }
    }
  }
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
      // v22 (PRE-3): anchor `config:` to the item's own child indent (two
      // spaces) — byte-identical with core preset-composition.ts. The old
      // `\s+` form matched a `config:` at any depth, silently skipping the
      // cap when a platform preset grew nested config maps.
      if (/^ {2}config:(\s|$)/.test(next)) hasConfig = true
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

async function installAgentPreset(home, dryRun, force, standardComposition) {
  const destination = agentPresetDirectory(home)
  // v21 (S-3): the composition is resolved by install() BEFORE any profile
  // mutation and passed in here — resolution failures now abort before the
  // host side has committed anything.
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
  const result = { mode, home, profile, profileDir, removedBundle: null, removedPackages: 0, removedAgentPreset: false, packagesKeptFor: [] }
  // v21 (S-1): consume the journal when present (installs made by this
  // installer since 0.3.65) so the reverse actions scope themselves to what
  // the installer ACTUALLY wrote. Journal-less installs (≤0.3.64) keep the
  // name-based fallback rules below.
  const journal = await readInstallJournal(profileDir)

  if (mode === 'host' || mode === 'layered' || mode === 'oneclick') {
    const bundleName = mode === 'oneclick' ? BUNDLES.oneclick : BUNDLES.host
    // D-17 (v18): report the real outcome in dry-run too (the old `!dryRun &&`
    // made a dry-run uninstall always claim no bundle would be removed).
    result.removedBundle = manifestCarriesBundle(profileDir, bundleName) ? bundleName : null
    if (!dryRun && result.removedBundle !== null) {
      await removeBundleFromProfile(profileDir, bundleName, { keepDependency: journal?.dependencyAdded === false })
    }
    // P1-2 (v11): evolution-all is a DEFAULT install target — uninstall must
    // remove its bundle row symmetrically, or the leftover row resolves a
    // package that was just deleted and bricks the profile.
    if (!dryRun) await removeBundleFromProfile(profileDir, BUNDLES.all)
    // D-2 (v18): the package set may only be deleted when NO evolution bundle
    // row remains. Deleting the packages while another row is still mounted
    // leaves a phantom row that bricks the profile at boot.
    const tailOf = (name) => String(name).slice(String(name).lastIndexOf('/') + 1)
    const removedTails = new Set([tailOf(bundleName), 'dsh-evolution-all'])
    const remaining = dryRun
      ? detectInstalledBundles(profileDir).filter(name => !removedTails.has(tailOf(name)))
      : detectInstalledBundles(profileDir)
    if (remaining.length > 0) {
      result.packagesKeptFor = remaining
      // v22 (R-2): a full uninstall did NOT complete (another bundle row still
      // holds packages) — keep the journal for the uninstall that will
      // actually replay it.
    } else if (journal !== null && Array.isArray(journal.copied)) {
      // v21 (S-1): journal-guided removal — delete exactly the packages THIS
      // installer copied (tails of the recorded scoped names), not every
      // scope entry that happens to match the family prefixes (a manually
      // installed or platform-shipped same-prefix package must survive).
      const scopeDir = join(profileDir, 'node_modules', EVOLUTION_SCOPE)
      const recorded = journal.copied.filter(name => typeof name === 'string' && name.length > 0)
      if (!dryRun) {
        for (const fullName of recorded) {
          await rm(join(scopeDir, fullName.slice(fullName.lastIndexOf('/') + 1)), { recursive: true, force: true })
        }
      }
      result.removedPackages = recorded.length
      // v22 (R-2): the replay completed — NOW the record can go. Deleted
      // inside the mode branch and only after the keep/removed decision, so
      // `--mode agent` (which never replays) and kept-package runs (oneclick
      // install + `uninstall --mode host`) preserve it.
      if (!dryRun) await rm(join(profileDir, INSTALL_JOURNAL), { force: true })
    } else {
      result.removedPackages = await removeCopiedEvolutionPackages(profileDir, dryRun)
      // v22 (R-2): journal-less legacy fallback completed — same rule.
      if (!dryRun && journal !== null) await rm(join(profileDir, INSTALL_JOURNAL), { force: true })
    }
  }
  if (mode === 'agent' || mode === 'layered') {
    // P2-42 (v11): report the real outcome — dry-run or an absent preset
    // directory does not mean "deleted".
    // v21 (S-1): the journal records whether THIS installer installed the
    // preset — a pre-existing preset (exists && !force skip) must survive the
    // uninstall of a preset-less host install.
    const presetSkippedByInstall = journal !== null && journal.agentPreset === false
    const presetDir = agentPresetDirectory(home)
    if (!dryRun && existsSync(presetDir) && !presetSkippedByInstall) {
      await rm(presetDir, { recursive: true, force: true })
      result.removedAgentPreset = true
    }
  }
  // v22 (R-2): the journal is consumed and deleted INSIDE the replaying mode
  // branch above (and only after the keep/removed decision) — the v21 attempt
  // placed an unconditional delete here, which discarded the record for
  // `--mode agent` runs and for uninstall modes whose reverse actions were
  // skipped (packages kept), re-opening the S-1 over-deletion hole.
  return result
}

/**
 * 0.3.54 (route B): is the target profile already carrying an evolution-all
 * bundle row? The full bundle and the layered Evolution preset are exclusive
 * on the model rows — returning the matched bundle names lets the installer
 * refuse up front with the choose-one guidance instead of the user reaching
 * the startup double-mount error.
 */
const EVOLUTION_BUNDLE_TAILS = ['dsh-evolution-all', 'dsh-evolution-host', 'dsh-evolution-preset']

/** D-1 (v18): every evolution bundle row in the profile, scope-agnostic
 * (exact-segment tail). Used by the three-way mutual-exclusion checks and by
 * uninstall to decide whether any bundle row would be left behind. */
export function detectInstalledBundles(profileDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    return bundles.filter((entry) => {
      if (typeof entry !== 'string') return false
      const trimmed = entry.trim()
      return EVOLUTION_BUNDLE_TAILS.some(tail => trimmed === tail || trimmed.endsWith(`/${tail}`))
    })
  } catch {
    return []
  }
}

export function detectInstalledAllBundle(profileDir) {
  // P3 (v15/v16): exact-segment tail match — a loose substring would
  // false-positive on `dsh-evolution-allowlist`.
  return detectInstalledBundles(profileDir).filter(name => /(?:^|\/)dsh-evolution-all$/.test(String(name).trim()))
}

/** N11 (v12): does this profile's manifest carry the given bundle row?
 * Scope-agnostic tail match — same rule the install-time conflict check uses. */
function manifestCarriesBundle(profileDir, bundle) {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    const tail = bundle.slice(bundle.lastIndexOf('/') + 1)
    return bundles.some(entry => typeof entry === 'string' && (entry === bundle || entry.endsWith(`/${tail}`)))
  } catch {
    return false
  }
}

export async function install(options = {}) {
  const mode = options.mode ?? 'layered'
  if (!MODES.has(mode)) throw new Error(`unknown mode ${mode}; expected one of ${[...MODES].join(', ')}`)
  const home = options.home ?? resolveHome(options.env)
  const profile = options.profile ?? 'web'
  const dryRun = options.dryRun === true
  const force = options.force === true

  const needsHost = mode === 'host' || mode === 'layered'
  const needsAgent = mode === 'agent' || mode === 'layered'
  const needsCompat = mode === 'oneclick'

  // v21 (S-3): resolve the standard preset composition BEFORE any profile
  // mutation — the old order committed bundle rows/copies and only tried to
  // build the preset afterwards, leaving a half-installed profile (host
  // mounted, preset missing) when the resolution failed. Resolution is
  // read-only and the "reported up front" intent at installAgentPreset now
  // actually holds.
  const standardComposition = needsAgent ? await resolveStandardComposition() : undefined

  // v21 (S-5): agent mode never writes the profile (its deliverable is the
  // preset directory) — do not CREATE one as a side effect. ensureProfile
  // used to run unconditionally, seeding a fresh DSH_HOME with a web profile
  // carrying a dependency-less bundle row that violates this script's own
  // D-3 rule. Read-only probes (conflict checks) tolerate a missing profile.
  const profileDir = dryRun || mode === 'agent'
    ? profileDirectory(home, profile)
    : await ensureProfile(home, profile)
  const result = { mode, home, profile, profileDir, copied: [], missingEntrypoints: [], bundle: null, agentPreset: null }
  // v21 (S-1): the bundle-dependency outcome, recorded onto the journal at the
  // end of the run (null in dry-run — no journal is written then anyway).
  let dependencyInfo = null
  // v23 (BR-3): journal payload builder — called once right after the
  // dependency row (the base record) and once after the preset phase (with
  // the refreshed preset accounting). Reads the mutable closables at call
  // time, so each write describes the state reached so far.
  const journalPayload = (presetInstalled) => ({
    version: 1,
    scope: EVOLUTION_SCOPE,
    bundle: result.bundle,
    dependencyAdded: dependencyInfo?.addedDependency === true,
    dependencyRange: dependencyInfo?.dependencyRange,
    copied: result.copied.map(entry => entry.packageName),
    agentPreset: presetInstalled,
    at: new Date().toISOString(),
  })
  // v23 (BR-3/BR-4): the PRIOR journal's accounting. A reinstall must not
  // reset the `agentPreset` bookkeeping of an earlier layered install — a
  // `--mode host` reinstall used to overwrite it with `false`, making the
  // already-installed preset unremovable by `uninstall --mode layered`.
  const priorJournal = await readInstallJournal(profileDir)

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
    // D-1 (v18): the reverse direction was missing — a one-click preset bundle
    // already mounts the four model rows at profile root, so generating the
    // agent preset on top double-mounts them (the documented three-way
    // mutual exclusion). Refuse with the same choose-one guidance.
    const oneclickBundles = detectInstalledBundles(profileDir)
      .filter(name => /(?:^|\/)dsh-evolution-preset$/.test(String(name).trim()))
    if (oneclickBundles.length > 0) {
      throw new Error(
        `install-layered: the profile already carries a one-click preset bundle (${oneclickBundles.join(', ')}). `
        + 'The one-click preset bundle and the layered Evolution preset are mutually exclusive install targets (E-33) — '
        + 'the one-click bundle already mounts the model tools at profile root, so the layered preset would double-mount them. '
        + 'Choose ONE: keep the one-click bundle, or uninstall it and install the host bundle + agent preset.',
      )
    }
    // v22 (PRE-1): the two checks above probe only the TARGET profile, but the
    // Evolution agent preset is a HOME-GLOBAL artifact
    // ($DSH_HOME/.agent-presets/evolution — see agentPresetDirectory). An
    // evolution-all / one-click row in ANY OTHER profile of this DSH_HOME
    // composes the same startup double-mount once the user selects the
    // preset, so the exclusion has to sweep every profile in the home.
    const profilesRoot = join(home, 'profiles')
    const conflictingProfiles = []
    if (existsSync(profilesRoot)) {
      for (const entry of await readdir(profilesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = profileDirectory(home, entry.name)
        if (dir === profileDir) continue
        for (const name of detectInstalledBundles(dir)) {
          if (/(?:^|\/)dsh-evolution-(all|preset)$/.test(String(name).trim())) {
            conflictingProfiles.push(`${entry.name}: ${name}`)
          }
        }
      }
    }
    if (conflictingProfiles.length > 0) {
      throw new Error(
        `install-layered: other profile(s) in this DSH_HOME already carry a full-model-rows bundle — ${conflictingProfiles.join('; ')}. `
        + 'The Evolution agent preset is HOME-GLOBAL and would double-mount those model rows at startup. '
        + 'Uninstall the bundle there, or keep using that profile instead of the layered preset.',
      )
    }
  }

  if (needsHost || needsCompat) {
    const bundleName = needsHost ? BUNDLES.host : BUNDLES.oneclick
    // D-1 (v18): the one-click preset bundle mounts the four model rows at
    // profile root; an existing agent preset mounts the same rows in preset
    // scope. Refuse unless --force explicitly confirms.
    if (needsCompat && existsSync(agentPresetDirectory(home)) && !force) {
      throw new Error(
        `install-layered: the DSH_HOME already carries an Evolution agent preset (${agentPresetDirectory(home)}). `
        + 'The one-click preset bundle and the layered agent preset are mutually exclusive install targets (E-33) — '
        + 'both mount the same model rows. Choose ONE '
        + '(remove the preset directory or pass --force to override explicitly).',
      )
    }
    // P1-3 (v11): evolution-all is the DEFAULT full bundle — installing host
    // or oneclick on top must refuse like host⇄preset does (the all patch
    // double-mounts the infra rows, startup fail-loud). The check runs in
    // dry-run too (N10, v12): dry-run resolves the REAL profileDir (only the
    // ensure/write is skipped), so a --dry-run --mode host against an all
    // profile reports the would-be refusal instead of claiming it installs.
    const installedAll = detectInstalledAllBundle(profileDir)
    if (installedAll.length > 0) {
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
    // semantics, not a row collision). P2-2 (v13): runs in dry-run too —
    // same rationale as the evolution-all check above (dry-run resolves the
    // real profileDir and the E-33 report must match the real mode).
    {
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
    if (!dryRun) {
      dependencyInfo = await installBundlePackage(profileDir, bundleName)
      // v23 (BR-3): the BASE journal lands right after the dependency row (the
      // baseline position, restored) — a crash during the preset phase must
      // still leave a replayable record. `agentPreset` carries the PRIOR
      // journal's accounting until this run actually (re)installs the preset
      // (v23 BR-4: a `--mode host` reinstall must not reset it to false).
      await writeInstallJournal(profileDir, journalPayload(priorJournal?.agentPreset === true))
    }
    result.missingEntrypoints = missingEntrypoints(result.copied)
  }

  if (needsAgent) {
    result.agentPreset = await installAgentPreset(home, dryRun, force, standardComposition)
  }

  // P1-3 (v19) + v21 (S-1) + v23 (BR-3/BR-4): the FINAL journal refreshes the
  // preset accounting with this run's actual outcome — `true` when the preset
  // was really (re)installed, otherwise the PRIOR journal's accounting is
  // preserved (a skipped preset still exists on disk and its uninstall
  // deliverable must not be lost to a host/oneclick reinstall).
  if (!dryRun && result.bundle !== null) {
    await writeInstallJournal(profileDir, journalPayload(result.agentPreset?.installed === true || priorJournal?.agentPreset === true))
  }

  return result
}

function parseArgs(argv) {
  const options = { mode: 'layered', profile: 'web' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    // D-15 (v18): a missing value used to fall through silently (`--mode`
    // kept the default, `--home` threw a bare TypeError from resolve()).
    const next = () => {
      const candidate = argv[i + 1]
      if (candidate === undefined || candidate.startsWith('--')) throw new Error(`${arg} requires a value`)
      i += 1
      return candidate
    }
    if (arg === '--mode') options.mode = next()
    else if (arg === '--profile') options.profile = next()
    else if (arg === '--home') options.home = resolve(next())
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--uninstall') options.uninstall = true
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

// v22 (R-3, supersedes v21 S-8): compare REAL paths with case-insensitive
// fallback on Windows. The two prior attempts both failed in practice:
// raw string equality broke on lowercase drive letters and symlinked
// invocations, and pathToFileURL alone preserves the argv[1] drive case
// (`file:///d:/...` vs `import.meta.url`'s `file:///D:/...`) — either way
// the CLI exited 0 SILENTLY without doing anything, the most dangerous
// failure shape for an installer. realpathSync resolves symlinks on both
// sides; the win32 lowercase compare absorbs drive-letter case.
const isMain = process.argv[1] !== undefined && (() => {
  try {
    const invoked = pathToFileURL(realpathSync(process.argv[1])).href
    const self = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    return invoked === self || (process.platform === 'win32' && invoked.toLowerCase() === self.toLowerCase())
  } catch {
    return false
  }
})()
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.uninstall) {
      const result = await uninstall(options)
      console.log(`uninstall mode:     ${result.mode}`)
      console.log(`profile:  ${result.profile} (${result.profileDir})`)
      if (result.removedBundle) console.log(`bundle:   ${result.removedBundle}`)
      console.log(`packages: ${result.removedPackages}`)
      if (result.packagesKeptFor.length > 0) {
        console.log(`kept:     packages retained for still-mounted bundle(s): ${result.packagesKeptFor.join(', ')}`)
      }
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
