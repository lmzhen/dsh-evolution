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
 * fallback for trees that ship no bundle source.
 * V24-17 (v24): the source root is a parameter so the staging-freshness check
 * inside `packageSourceRoot()` can call this WITHOUT re-entering
 * `packageSourceRoot()` (the no-argument form resolves the root through the
 * staging branch, which would recurse). */
function familyVersion(sourceRoot = packageSourceRoot()) {
  try {
    const version = JSON.parse(readFileSync(join(sourceRoot, 'evolution-host', 'package.json'), 'utf8')).version
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
    // V24-17 (v24): the freshness baseline is the FAMILY version read from
    // the FAMILY SOURCE tree (PACKAGES_DIR), the same authority the
    // dependency pin's `familyVersion()` uses. The old `rootPackageVersion()`
    // walks ancestors and lands on the HOST root manifest in an overlay/dev
    // tree (0.1.x) — so a freshly built 0.3.x staging was rejected as "stale"
    // against a host version it has nothing to do with. P2-22 fixed the pin
    // in v19 but left this姊妹 call site on the ancestor walk; the two
    // version notions have diverged here ever since. PACKAGES_DIR is passed
    // explicitly: the default-argument form re-enters `packageSourceRoot()`
    // and would recurse.
    const expected = familyVersion(PACKAGES_DIR)
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

/** v31 INST-01: the profile manifest and the install journal are the two
 * files whose loss or truncation misleads every later install/uninstall
 * decision (the manifest carries every bundle row; the journal carries the
 * preset-ownership record) — write them through the same tmp+rename
 * discipline the yml assets already get (F-354), so a crash mid-write cannot
 * leave a truncated file for the next boot to choke on. */
async function writeManifestAtomic(manifestPath, contents) {
  // v32 REG-02: the parent directory may not exist yet (agent-mode installs
  // journal into profiles/<p>/ without ever running ensureProfile) — create
  // it before the tmp write, or the ENOENT aborts the install AFTER the
  // preset is already on disk.
  await mkdir(dirname(manifestPath), { recursive: true })
  const tmp = `${manifestPath}.${process.pid}.tmp`
  await writeFile(tmp, contents)
  await rename(tmp, manifestPath)
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
      // v31 INST-02: release STAGING also carries each package's own `npm
      // pack` tarball — copying it into the user profile doubled the family's
      // on-disk size per package.
      return base !== 'node_modules'
        && !base.startsWith('tests')
        && !base.endsWith('.tsbuildinfo')
        && !base.endsWith('.tgz')
    },
  })
}

/** D-4 (v18): upstream `initProfile` seeds a named profile with its template
 * bundles. The hand-rolled copy seeded an EMPTY list, so a profile the
 * installer created itself lacked the platform base/web-app rows. Platform
 * packages are always `@deepseek-ai`-scoped (only the family packages are
 * scope-rewritten at publish).
 *
 * FROZEN COPY of the platform's `PROFILE_TEMPLATES` +
 * `DEFAULT_PROFILE_PATCH_RELOAD` (`packages/boot/app-boot/src/profile.ts`).
 * The installer runs BEFORE any dsh profile exists, so it cannot ask the
 * platform — this table is a snapshot by design, and
 * `scripts/verify-platform-contract.mjs --upstream <platform-tree>` is the
 * probe that turns it red when the platform's table moves. */
const PROFILE_SEED_TEMPLATES = {
  acp: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'], patchReload: 'startup' },
  web: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' },
  headless: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'], patchReload: 'startup' },
  sdk: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'], patchReload: 'startup' },
  // The platform's `sdk-minimal` template carries the sdk package alone.
  'sdk-minimal': { bundles: ['@deepseek-ai/dsh-sdk-minimal'], patchReload: 'startup' },
}
/** Upstream `DEFAULT_PROFILE_BUNDLES` / `DEFAULT_PROFILE_PATCH_RELOAD`: a
 * profile name with no shipped template gets the base row and live reload. */
const DEFAULT_SEED_TEMPLATE = { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'live' }

/** The platform template a profile name resolves to.
 * @param profile - the profile name.
 * @returns the template's bundles and patch-file lifecycle. */
function profileSeed(profile) {
  return Object.prototype.hasOwnProperty.call(PROFILE_SEED_TEMPLATES, profile)
    ? PROFILE_SEED_TEMPLATES[profile]
    : DEFAULT_SEED_TEMPLATE
}

async function ensureProfile(home, profile) {
  const dir = profileDirectory(home, profile)
  await mkdir(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    const seed = profileSeed(profile)
    // v31 INST-01: the seed write is atomic like every other manifest write.
    await writeManifestAtomic(manifestPath, JSON.stringify({
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {},
      dsh: {
        profile: {
          bundles: [...seed.bundles],
          patchReload: seed.patchReload,
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
  await writeManifestAtomic(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { addedDependency, dependencyRange: manifest.dependencies[bundleName] }
}

/** P1-3 (v19): the install journal. Every profile-level write the installer
 * makes (bundle row, dependency row, copied packages, agent preset) is
 * recorded here so uninstall can replay it in reverse instead of guessing.
 * Absent for installs made by 0.3.64 and earlier — uninstall falls back to the
 * name-based rules for those. */
const INSTALL_JOURNAL = '.evolution-install.json'

async function writeInstallJournal(profileDir, journal) {
  // v31 INST-01: the journal drives INST-03/04 uninstall decisions — atomic
  // like the manifest, so a crash cannot leave a truncated journal that
  // misreports what the installer owns.
  await writeManifestAtomic(join(profileDir, INSTALL_JOURNAL), JSON.stringify(journal, null, 2) + '\n')
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
  await writeManifestAtomic(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
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
 * vendored baseline; v33 G2.1 — ask the platform first):
 *   1. `DSH_AGENT_PRESET_ROOT` (explicit, points at an agent-presets root);
 *   2. `node_modules/@deepseek-ai/dsh-agent-presets/presets` — the 0.1.5+
 *      shipped-preset location (the platform resolves it through
 *      `SHIPPED_PRESET_ROOT`, and the CLI package no longer publishes
 *      `config/`);
 *   3. `packages/preset/agent-presets/presets` — the 0.1.5 SOURCE-checkout
 *      location (the presets left the CLI package in 0.1.5);
 *   4. `apps/cli/config/agent-presets/...` — the pre-0.1.5 source/CLI-package
 *      location, kept as a fallback;
 *   5. the globally installed `@deepseek-ai/dsh` (npm root -g), in the nested
 *      `dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets` form npm
 *      actually produces, the sibling `dsh-agent-presets/presets` form, and the
 *      legacy `dsh/config/agent-presets` form.
 * Fails loud otherwise: a preset built from a guessed baseline would silently
 * mismatch the platform it runs on.
 */
async function resolveStandardComposition() {
  const standardName = join('standard', 'agent.cordis.yml')
  const direct = (root) => join(root, standardName)
  /** Candidate agent-preset roots under one tree level, platform form first. */
  const rootsAt = (level) => [
    join(level, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets'),
    // v33 G0 (post-migration sweep): the 0.1.5 SOURCE layout. The presets left
    // the CLI package, so `apps/cli/config/agent-presets` no longer exists in a
    // 0.1.5 checkout and this branch — not the node_modules one, which needs a
    // linked workspace — is what a source tree actually has.
    join(level, 'packages', 'preset', 'agent-presets', 'presets'),
    join(level, 'apps', 'cli', 'config', 'agent-presets'),
  ]

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
    for (const root of rootsAt(level)) {
      const path = direct(root)
      if (existsSync(path)) return await readFile(path, 'utf8')
    }
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
        for (const candidate of [
          // The npm GLOBAL shape: `dsh-agent-presets` is a DEPENDENCY of the CLI
          // package, so npm nests it under `dsh/node_modules/...`; the sibling
          // form below only exists when the user installed it separately.
          join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets'),
          join(root, '@deepseek-ai', 'dsh-agent-presets', 'presets'),
          join(root, '@deepseek-ai', 'dsh', 'config', 'agent-presets'),
        ]) {
          const path = direct(candidate)
          if (existsSync(path)) return await readFile(path, 'utf8')
        }
      }
    } else {
      // R-08 (V10): `npm` is a PATH executable on POSIX and the Windows branch
      // above never reaches this line, so spawn it shell-free like every other
      // child process in this script (shell: true re-introduced the injection
      // surface and quoting hazards the rest of the file deliberately avoids).
      const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
      for (const candidate of [
        join(globalRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets'),
        join(globalRoot, '@deepseek-ai', 'dsh-agent-presets', 'presets'),
        join(globalRoot, '@deepseek-ai', 'dsh', 'config', 'agent-presets'),
      ]) {
        const path = direct(candidate)
        if (existsSync(path)) return await readFile(path, 'utf8')
      }
    }
  } catch {
    // npm root -g is unavailable; fall through to the loud error below.
  }

  throw new Error(
    'install-layered: cannot find a runtime `standard` agent preset — install dsh first, '
    + 'set DSH_AGENT_PRESET_ROOT, or run from a source checkout. DSH 0.1.5+ ships the presets '
    + 'inside the dsh-agent-presets package — probed as '
    + '<tree>/node_modules/@deepseek-ai/dsh-agent-presets/presets, '
    + '<tree>/packages/preset/agent-presets/presets (source checkout), and the global '
    + '<npm-root>/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets; '
    + 'pre-0.1.5 platforms kept them at apps/cli/config/agent-presets.',
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
      // V24-16 (v24): the scope comes from the JOURNAL, not the current
      // environment — the journal records the scope the install actually
      // used (`scope:` field, written since v1 of the format but never
      // read). With `EVOLUTION_SCOPE=@lmzhen` at install time and an
      // unscoped shell at uninstall time, the old code rm'd under
      // `@deepseek-ai/` (nonexistent) with `force: true` — every removal
      // no-op'd silently while the summary still reported
      // `removedPackages = N`, leaving the real packages on disk.
      const journalScope = typeof journal.scope === 'string' && journal.scope.length > 0 ? journal.scope : EVOLUTION_SCOPE
      if (journalScope !== EVOLUTION_SCOPE) {
        console.warn(`install-layered: journal was written under scope "${journalScope}" but EVOLUTION_SCOPE is "${EVOLUTION_SCOPE}" — removing from "${journalScope}" (set EVOLUTION_SCOPE=${journalScope} to silence this warning)`)
      }
      const scopeDir = join(profileDir, 'node_modules', journalScope)
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
    // v31 INST-04: the preset is HOME-GLOBAL — before deleting it, sweep the
    // other profiles the same way the install side (PRE-1) does. Another
    // profile carrying bundle rows or a preset-owning journal means its
    // sessions still mount the preset's model rows.
    let otherProfileStillUsesPreset = false
    if (!presetSkippedByInstall && existsSync(presetDir)) {
      const profilesDir = join(home, 'profiles')
      if (existsSync(profilesDir)) {
        for (const entry of await readdir(profilesDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          // v32 INST-08: case-insensitive (Windows) — a `Web` vs `web`
          // spelling must not make the sweep probe the profile being
          // uninstalled as if it were "another profile".
          if (profileDirectory(home, entry.name).toLowerCase() === profileDir.toLowerCase()) continue
          const others = detectInstalledBundles(join(profilesDir, entry.name), (warnError) => {
            console.warn(`install-layered: ${warnError instanceof Error ? warnError.message : String(warnError)}`)
          })
          if (others.length > 0) { otherProfileStillUsesPreset = true; break }
          const otherJournal = readInstallJournal(join(profilesDir, entry.name))
          if (otherJournal?.agentPreset === true) { otherProfileStillUsesPreset = true; break }
        }
      }
    }
    if (!dryRun && existsSync(presetDir) && !presetSkippedByInstall && !otherProfileStillUsesPreset) {
      await rm(presetDir, { recursive: true, force: true })
      result.removedAgentPreset = true
    } else if (otherProfileStillUsesPreset) {
      console.warn('install-layered: the home-global Evolution preset was KEPT — another profile still carries evolution bundles or a preset-owning journal')
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
export function detectInstalledBundles(profileDir, warn = () => {}) {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    return bundles.filter((entry) => {
      if (typeof entry !== 'string') return false
      const trimmed = entry.trim()
      return EVOLUTION_BUNDLE_TAILS.some(tail => trimmed === tail || trimmed.endsWith(`/${tail}`))
    })
  } catch (error) {
    // v31 INST-01 + INST-07: a MISSING manifest is the legitimate fresh-home
    // shape (reads as "no bundles", silently). A PRESENT but unparsable
    // manifest is the corruption warn — a later reinstall would proceed on
    // top of it.
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code !== undefined && code !== 'ENOENT') {
      warn(`profile manifest at ${join(profileDir, 'package.json')} could not be parsed (${error instanceof Error ? error.message : String(error)}) — treating as no bundles installed; the profile may be corrupted`)
    }
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
  // v31 INST-07: pure path resolution here — ensureProfile moved BELOW the
  // refusal sweep, so a refused install no longer leaves a freshly seeded
  // empty profile behind (v21 S-5 closed agent mode; this closes
  // host/layered/oneclick).
  const profileDir = profileDirectory(home, profile)
  const profileReady = !dryRun && mode !== 'agent'
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
    // v31 INST-07: the FIRST profile mutation happens here — every refusal
    // check has passed, so a refused install can no longer leave a seeded
    // empty profile behind.
    // v33 F-1: ensureProfile is IDEMPOTENT (mkdir idempotent, manifest/patch/
    // workspace seeded only while missing) - run it whenever the profile is
    // in scope. The old `!existsSync(profileDir)` gate let an agent-journal
    // -only directory (REG-02's mkdir, no manifest) skip the manifest seed,
    // bricking the next host/layered install with a mid-copy ENOENT.
    if (profileReady) await ensureProfile(home, profile)
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
  // v31 INST-03: `--mode agent` installs the home-global preset with NO
  // bundle row — the old `result.bundle !== null` gate never journaled it, so
  // a later layered uninstall read `agentPreset:false` and left the preset
  // stranded while reporting a clean removal. Journal the ownership.
  if (!dryRun && result.bundle === null && result.agentPreset?.installed === true) {
    await writeInstallJournal(profileDir, journalPayload(true))
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
