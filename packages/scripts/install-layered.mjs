#!/usr/bin/env node
/**
 * Local installer for the dsh-evolution family.
 *
 * Install modes (0.48):
 *   all      the full product bundle (default)
 *   host     the infrastructure-only bundle
 *
 * Reverse-only modes (one version): agent, layered and oneclick are accepted by
 * --uninstall to remove a 0.46/0.47 install. Their install paths and the
 * installer-side preset composer were removed in 0.48.
 *
 * This installer targets DSH source/debug layouts: it copies the evolution
 * packages into the profile's node_modules and writes the profile manifest.
 * For a production install, prefer `dsh plugin add` against the published
 * bundle package.
 */

import { DIST_SOURCE_ROOT, EVOLUTION_SCOPE, PACKAGES_DIR, STAGING_DIR, familyVersion, packageSourceRoot } from './install/source-tree.mjs'
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const BUNDLES = {
  host: `${EVOLUTION_SCOPE}/dsh-evolution-host`,
  oneclick: `${EVOLUTION_SCOPE}/dsh-evolution-preset`,
  all: `${EVOLUTION_SCOPE}/dsh-evolution-all`,
}

const MODES = new Set(['all', 'host', 'agent', 'layered', 'oneclick'])
// 0.3.77 (C axis): the two PRODUCT forms get first-class names. `variant` is
// the session-level opt-in layout (host bundle + generated preset = the
// historical `layered`); `attach` mounts everything on the original presets
// (= `oneclick`). The old names stay valid; one normalizer so a library caller
// and the CLI cannot disagree about which mode was asked for.
const MODE_ALIASES = new Map([['variant', 'layered'], ['attach', 'oneclick']])
const normalizeMode = (mode) => MODE_ALIASES.get(mode) ?? mode
/** The product form a mode installs: ① variant / ② attach / infra-only / preset-only. */
function deploymentFormOf(mode) {
  if (mode === 'all') return 'attach'
  if (mode === 'layered') return 'variant'
  if (mode === 'oneclick') return 'attach'
  if (mode === 'host') return 'host-only'
  return 'preset-only'
}
// v43 audit (S1-2): the allowlist moved to lib-family-packages.mjs so this
// installer and verify-package-discovery.mjs read ONE array. A local copy here
// let a new package be published while the installer silently ignored it.
import { EVOLUTION_BUNDLE_TAILS, EVOLUTION_PREFIXES, RETIRED_PACKAGE_NAMES } from './lib-family-packages.mjs'

// G2-S2: the ONE composer lives in evolution-core. The source installer consumes the BUILT
// artifact (CI runs build-lib before tests/publish); a missing build fails loud with the fix.
//
const COMPOSER_LIB_URL = DIST_SOURCE_ROOT === null
  ? new URL('../evolution-core/lib/composition/index.js', import.meta.url)
  : pathToFileURL(join(DIST_SOURCE_ROOT, 'dsh-evolution-core', 'lib', 'composition', 'index.js'))
if (!existsSync(fileURLToPath(COMPOSER_LIB_URL))) {
  console.error('install-layered: ' + (DIST_SOURCE_ROOT === null ? 'evolution-core build is missing (' + fileURLToPath(COMPOSER_LIB_URL) + '). Run: node packages/scripts/build-lib.mjs' : 'the packed core tarball carries no lib/composition/index.js (' + fileURLToPath(COMPOSER_LIB_URL) + ')'))
  process.exit(1)
}
const composer = await import(COMPOSER_LIB_URL.href)
const {
  presetRowId,
  presetRowBlock,
  presetPatchText,
  removePresetRow,
} = composer

export function resolveHome(env = process.env) {
  // v21 (D-5): the installer must land packages in the SAME tree the runtime
  // reads. PLAN S2.2 (2026-09-16, review B-P2): `trim()` is the ADOPTION test
  // only, the VALUE is the raw env text, and the result is ALWAYS resolved with
  // `~` expansion — the line-for-line shape of core's `evolutionRoot`
  // (evolution-core/src/state-store.ts) and the platform's `resolveDshHome`.
  // The earlier "trim the value we RESOLVE" form sent `DSH_HOME=" /x "` to
  // resolve('/x') while the runtime resolved resolve(' /x ') — a tree the
  // plugins never read, the very failure this function exists to prevent — and
  // it left `~` unexpanded where the runtime expands it.
  const fromEnv = env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  const expanded = selected === '~'
    ? homedir()
    : selected.startsWith('~/') || selected.startsWith('~\\')
      ? join(homedir(), selected.slice(2))
      : selected
  return resolve(expanded)
}

export function profileDirectory(home, profile) {
  return join(home, 'profiles', profile)
}

/**
 * The agent-preset BASES a layered install can compose the Evolution preset on.
 *
 * A base names the runtime platform preset whose rows are merged verbatim
 * (`packages/bundle/web-app/presets/<base>.patch.yml`); the evolution delta is
 * identical for every base, so a variant differs only in which platform
 * composition it follows, the preset id it registers under, and the display
 * copy it publishes. This table is the single authority for all four: the base
 * patch resolver, the preset/row ids, the published display copy, and the
 * refusal sweeps all read it, so a variant cannot be half-added (an id one
 * consumer knows and another does not is exactly the stranded / double-mounted
 * preset this installer keeps re-learning).
 *
 * The id must satisfy the platform's own `PRESET_ID`
 * (`packages/preset/agent-preset-registry/src/preset.ts`, `/^[a-z0-9][a-z0-9-]*$/`).
 * The id also decides display copy: the platform resolves localized text for its
 * SHIPPED ids only — a preset that publishes no `name` is looked up in the
 * dictionary by id and falls back to the bare id
 * (`packages/preset/agent-preset-registry/src/display.ts:47-72`) — so a family
 * variant publishes its own `name` / `description` / `order`.
 */
// 0.3.75 (v41 P2-26 sibling): the table lives in the agent package's
// bases.json, which is ALSO what `/evolution preset install --base` reads at
// runtime — the npm path used to know `standard` only, so an npm-installed
// family could not reach the ptc variant at all. `name` is one fact: the
// `--base` value, the platform composition directory, and the agent-preset
// registry id the runtime composes against.
export const AGENT_PRESET_BASES = Object.freeze(Object.fromEntries(
  readAgentPresetTable().bases.map(base => [base.name, Object.freeze({ id: base.id, display: Object.freeze({ ...base.display }), requires: base.requires, unsupported: base.unsupported })]),
))

function readAgentPresetTable() {
  const path = fileURLToPath(new URL('../evolution-agent/bases.json', import.meta.url))
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`install-layered: cannot read the agent-preset table ${path} (${error instanceof Error ? error.message : String(error)})`)
  }
  const bases = parsed?.bases
  if (!Array.isArray(bases) || bases.length === 0) {
    throw new Error(`install-layered: ${path} carries no bases[] — refusing to install without a preset table`)
  }
  const table = bases.map(base => {
    if (typeof base?.name !== 'string' || typeof base?.id !== 'string') {
      throw new Error(`install-layered: ${path} entry ${JSON.stringify(base)} needs name/id strings`)
    }
    // The display copy is REQUIRED, not decorative: the platform localizes its
    // own shipped ids only, so a variant without a name lists as its bare id.
    const display = base.display
    if (display === null || typeof display !== 'object'
      || typeof display.name !== 'string' || display.name === ''
      || typeof display.description !== 'string' || display.description === ''
      || !Number.isInteger(display.order)) {
      throw new Error(`install-layered: ${path} entry "${base.name}" needs display { name, description, order } (name/description strings, order integer)`)
    }
    // G1-② (0.3.78): the optional ability fields are validated, never ignored —
    // a mistyped requires/unsupported would silently turn a refusal into an
    // install, which is the failure mode they exist to prevent.
    if (base.requires !== undefined && (typeof base.requires !== 'object' || base.requires === null || typeof base.requires.service !== 'string')) {
      throw new Error(`install-layered: ${path} entry "${base.name}" needs requires.service as a string`)
    }
    if (base.unsupported !== undefined && (typeof base.unsupported !== 'string' || base.unsupported === '')) {
      throw new Error(`install-layered: ${path} entry "${base.name}" needs unsupported as a non-empty reason string`)
    }
    const entry = { name: base.name, id: base.id, display: { name: display.name, description: display.description, order: display.order } }
    if (base.requires !== undefined) entry.requires = { service: base.requires.service }
    if (base.unsupported !== undefined) entry.unsupported = base.unsupported
    return entry
  })
  const defaultBase = parsed?.default
  if (typeof defaultBase !== 'string' || !table.some(base => base.name === defaultBase)) {
    throw new Error(`install-layered: ${path} default ${JSON.stringify(defaultBase)} is not one of ${table.map(base => base.name).join(', ')}`)
  }
  return { defaultBase, bases: table }
}

/** The base a run composes on when the caller names none — bases.json's
 * `default`, so the table and its default cannot disagree. */
export const DEFAULT_AGENT_PRESET_BASE = readAgentPresetTable().defaultBase

/**
 * Resolve one base name to its canonical entry.
 *
 * Fails loud on anything outside {@link AGENT_PRESET_BASES}: a silent fallback
 * to `standard` would install the wrong preset under the requested variant's
 * name — a session that mounts rows the user did not ask for, with nothing in
 * the output saying so. The lookup is own-property only, so an inherited name
 * (`constructor`, `toString`) cannot pass for a base either.
 * @param base - the base name; defaults to {@link DEFAULT_AGENT_PRESET_BASE}.
 * @returns the canonical entry, carrying the resolved `base` name.
 */
export function resolveAgentPresetBase(base = DEFAULT_AGENT_PRESET_BASE) {
  const name = typeof base === 'string' ? base.trim() : ''
  if (name !== '' && Object.hasOwn(AGENT_PRESET_BASES, name)) return { base: name, ...AGENT_PRESET_BASES[name] }
  throw new Error(
    `install-layered: unknown agent-preset base ${JSON.stringify(base)}; expected one of ${Object.keys(AGENT_PRESET_BASES).join(', ')}`,
  )
}

/**
 * Resolve the caller's base selection — one name, a comma list, or repeats —
 * into a deduplicated, table-ordered list.
 *
 * The variant install is ONE decision ("which platform compositions should the
 * family follow?"), not a single choice: a user who switches between the
 * standard and the ptc platform preset needs both variants on disk, and asking
 * them to re-run the installer once per base leaves two generated presets that
 * may follow two different platform versions. Order follows bases.json rather
 * than argument order, so the same request always produces the same set.
 * @param selection - `undefined` (the table default), one name, or a list of
 * names (each entry may itself be a comma list).
 * @returns the canonical entries, each carrying its resolved `base` name.
 */
export function resolveAgentPresetBases(selection = undefined) {
  const raw = selection === undefined ? [DEFAULT_AGENT_PRESET_BASE] : Array.isArray(selection) ? selection : [selection]
  const names = new Set()
  for (const item of raw) {
    for (const part of String(item).split(',')) {
      const name = part.trim()
      if (name === '') continue
      // Validate EVERY name before any of them is used: a typo in the second
      // entry must not install the first variant and then abort.
      resolveAgentPresetBase(name)
      names.add(name)
    }
  }
  if (names.size === 0) {
    throw new Error(`install-layered: no agent-preset base selected; expected one or more of ${Object.keys(AGENT_PRESET_BASES).join(', ')}`)
  }
  return Object.keys(AGENT_PRESET_BASES).filter(base => names.has(base)).map(base => resolveAgentPresetBase(base))
}

/** The profile's own patch layer — the file a family preset row is written to
 * (`packages/boot/app-boot/src/profile.ts`, `PROFILE_PATCH_FILENAME`). */
export function profilePatchPath(home, profile = 'web') {
  return join(profileDirectory(home, profile), 'cordis.patch.yml')
}

export function scopedName(packageName, scope = EVOLUTION_SCOPE) {
  return packageName.startsWith(`${scope}/`)
    ? packageName.slice(scope.length + 1)
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

/**
 * Remove or recover swap residue left by an interrupted copy.
 *
 * P2-37: a crash between "old tree moved aside" and "staged tree renamed in"
 * leaves NO destination and a `.previous-*` tree. The next run restores it before
 * copying again. Staging dirs from other pids are deleted once the destination
 * exists (an old pid can never own a live tree again).
 * @param destination - the package directory about to be replaced.
 */
async function recoverCopySwap(destination) {
  const parent = dirname(destination)
  const base = destination.slice(parent.length + 1)
  let entries
  try { entries = await readdir(parent) } catch { return }
  for (const entry of entries) {
    if (!entry.startsWith(base + '.previous-') && !entry.startsWith(base + '.staging-')) continue
    const path = join(parent, entry)
    if (entry.startsWith(base + '.previous-') && !existsSync(destination)) {
      await rename(path, destination)
      continue
    }
    await rm(path, { recursive: true, force: true })
  }
}

export async function copyPackage(source, destination) {
  await mkdir(dirname(destination), { recursive: true })
  // P2-22a/P2-37: stage the copy into a sibling `.staging-<pid>` FIRST, then
  // swap via `.previous-<pid>`. A crash before the swap leaves the previous
  // tree intact; a crash inside the two renames is recoverable on the next run.
  const staging = `${destination}.staging-${process.pid}`
  const previous = `${destination}.previous-${process.pid}`
  await recoverCopySwap(destination)
  await rm(staging, { recursive: true, force: true })
  await cp(source, staging, {
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
  // Swap: move the live tree aside atomically, then rename the staged tree in.
  // On failure restore the old tree so the package is never missing.
  let movedAside = false
  try {
    if (existsSync(destination)) {
      await rm(previous, { recursive: true, force: true })
      await rename(destination, previous)
      movedAside = true
    }
    await rename(staging, destination)
  } catch (error) {
    if (!existsSync(destination) && existsSync(previous)) {
      try { await rename(previous, destination) } catch { /* the next run's recoverCopySwap retries */ }
    }
    throw error
  } finally {
    if (movedAside) await rm(previous, { recursive: true, force: true })
  }
}

/** D-4 (v18): upstream `initProfile` seeds a named profile with its template
 * bundles. The hand-rolled copy seeded an EMPTY list, so a profile the
 * installer created itself lacked the platform base/web-app rows. Platform
 * packages are always `@deepseek-ai`-scoped (only the family packages are
 * scope-rewritten at publish).
 *
 * FROZEN COPY of the platform's `PROFILE_TEMPLATES` + `DEFAULT_PROFILE_BUNDLES`
 * (`packages/boot/app-boot/src/profile.ts`). The installer runs BEFORE any dsh
 * profile exists, so it cannot ask the platform — this table is a snapshot by
 * design, and `scripts/verify-platform-contract.mjs --upstream <platform-tree>`
 * compares it name by name and bundle by bundle with the platform's table. */
const PROFILE_SEED_TEMPLATES = {
  acp: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] },
  web: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] },
  headless: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] },
  sdk: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'] },
  // The platform's `sdk-minimal` template carries the sdk package alone.
  'sdk-minimal': { bundles: ['@deepseek-ai/dsh-sdk-minimal'] },
}
/** Upstream `DEFAULT_PROFILE_BUNDLES`: a profile name with no shipped template
 * gets the base row. */
const DEFAULT_SEED_TEMPLATE = { bundles: ['@deepseek-ai/dsh-base'] }

/** The platform template a profile name resolves to.
 * @param profile - the profile name.
 * @returns the template's bundles. */
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
        },
      },
    }, null, 2) + '\n')
  }
  const patchPath = join(dir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) await atomicSeedWrite(patchPath, '[]\n')
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) {
    await atomicSeedWrite(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  }
  return dir
}

/** A8 (audit P2-22b): seed files are written tmp+rename ATOMIC, like every
 * other profile write. The former in-place `writeFile` meant one crash inside
 * the tiny seed window left a zero/partial-byte `cordis.patch.yml` that every
 * later run sees as present and never heals — and the platform aborts boot on
 * an unparsable patch file, permanently. */
async function atomicSeedWrite(file, contents) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(tmp, contents)
  await rename(tmp, file)
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
    const bareName = packageName.startsWith('@') ? (packageName.split('/')[1] ?? '') : packageName
    if (RETIRED_PACKAGE_NAMES.has(bareName)) continue
    if (!EVOLUTION_PREFIXES.some(prefix => bareName.startsWith(prefix))) continue
    // The shared client kit is a community-scope library even in a @deepseek-ai tree; keep its
    // declared scope so the browser bundle's import resolves to the copy this installer writes.
    const destinationScope = packageName.startsWith('@lmzhen/') ? '@lmzhen' : EVOLUTION_SCOPE
    const destination = join(profileDir, 'node_modules', destinationScope, scopedName(packageName, destinationScope))
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
  // Only the legacy nested copy belongs to the installer. The canonical
  // @lmzhen/dsh-evolution-client-kit may be a pnpm-installed dependency of the
  // profile; the journal path removes exactly what this run copied.
  const legacyNestedKit = join(profileDir, 'node_modules', '@lmzhen', '@lmzhen', 'dsh-evolution-client-kit')
  if (existsSync(legacyNestedKit)) {
    if (!dryRun) await rm(legacyNestedKit, { recursive: true, force: true })
    removed += 1
  }
  return removed
}

export async function uninstall(options = {}) {
  const mode = normalizeMode(options.mode ?? 'all')
  if (!MODES.has(mode)) throw new Error(`unknown mode ${mode}; expected one of ${[...MODES].join(', ')} (or the product names variant/attach)`)
  const home = options.home ?? resolveHome(options.env)
  const profile = options.profile ?? 'web'
  const dryRun = options.dryRun === true
  const profileDir = profileDirectory(home, profile)
  const result = { mode, home, profile, profileDir, removedBundle: null, removedPackages: 0, removedAgentPreset: false, removedPresetBases: [], packagesKeptFor: [] }
  // v21 (S-1): consume the journal when present (installs made by this
  // installer since 0.3.65) so the reverse actions scope themselves to what
  // the installer ACTUALLY wrote. Journal-less installs (≤0.3.64) keep the
  // name-based fallback rules below.
  const journal = await readInstallJournal(profileDir)

  if (mode === 'all' || mode === 'host' || mode === 'layered' || mode === 'oneclick') {
    const bundleName = mode === 'all' ? BUNDLES.all : mode === 'oneclick' ? BUNDLES.oneclick : BUNDLES.host
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
      ? detectInstalledBundles(profileDir, warnManifest).filter(name => !removedTails.has(tailOf(name)))
      : detectInstalledBundles(profileDir, warnManifest)
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
      const recorded = journal.copied.filter(name => typeof name === 'string' && name.length > 0)
      if (!dryRun) {
        for (const fullName of recorded) {
          const packageScope = fullName.startsWith('@') ? fullName.slice(0, fullName.indexOf('/')) : journalScope
          await rm(join(profileDir, 'node_modules', packageScope, fullName.slice(fullName.lastIndexOf('/') + 1)), { recursive: true, force: true })
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
    // P2-42 (v11): report the real outcome — a dry-run, or a patch with no
    // family row, does not mean "deleted".
    // v21 (S-1): the journal records whether THIS installer installed the
    // preset — a row it declined to overwrite (`--force` was not given) must
    // survive the uninstall of a preset-less host install.
    const presetSkippedByInstall = journal !== null && journal.agentPreset === false
    // Which preset ROWS this run owns. With no `--base` the uninstall is not
    // narrowed: every family preset row in this profile's patch is an
    // installer-generated artifact of this family, and a variant left behind
    // after "uninstall" would keep mounting family model rows for any session
    // that selects it. Naming a base narrows the reverse action to that variant.
    const presetSelection = options.bases !== undefined && options.bases.length > 0 ? options.bases : options.base
    const presetTargets = presetSelection === undefined
      ? Object.keys(AGENT_PRESET_BASES).map(entry => resolveAgentPresetBase(entry))
      : resolveAgentPresetBases(presetSelection)
    // The row lives in THIS profile's own patch layer (0.2.x), so the reverse
    // action reads that one file — no other profile is consulted, and removing
    // the row here leaves every other profile untouched by construction.
    const patchPath = profilePatchPath(home, profile)
    const patchText = existsSync(patchPath) ? await readFile(patchPath, 'utf8') : ''
    const presentPresets = presetTargets.filter(entry => presetRowBlock(patchText, presetRowId(entry.id)) !== null)
    if (!dryRun && presentPresets.length > 0 && !presetSkippedByInstall) {
      let text = patchText
      for (const entry of presentPresets) text = removePresetRow(text, presetRowId(entry.id))
      await writeManifestAtomic(patchPath, presetPatchText(text))
      result.removedAgentPreset = true
      result.removedPresetBases = presentPresets.map(entry => entry.base)
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

/** D-1 (v18): every evolution bundle row in the profile, scope-agnostic
 * (exact-segment tail). Used by the three-way mutual-exclusion checks and by
 * uninstall to decide whether any bundle row would be left behind. */
/** A8 (audit P2-21): install-path callers of `detectInstalledBundles` used the
 * silent default `warn`, so a PRESENT-but-unparsable profile manifest — the
 * corruption state this function exists to report — reached every exclusion
 * sweep as a silent empty list and the install proceeded on top of it. All
 * install-path sites pass this printer (the uninstall other-profile sweep
 * keeps its own callback). */
function warnManifest(message) {
  console.warn(`install-layered: warning — ${message}`)
}

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

/** Every bundle package name the profile's manifest mounts, scope-agnostic and as written — the
 * candidate list the base-patch resolver probes under that profile's `node_modules`.
 * @param profileDir - the profile directory.
 * @returns the bundle rows; empty when the manifest is missing or torn. */

/** The family preset rows one profile patch carries, in table order.
 * @param patchText - the profile patch text.
 * @returns one `{ base, rowId }` per base whose row is present. */
export function profilePresetRows(patchText) {
  return Object.keys(AGENT_PRESET_BASES)
    .map(name => resolveAgentPresetBase(name))
    .map(entry => ({ base: entry.base, rowId: presetRowId(entry.id) }))
    .filter(entry => presetRowBlock(patchText, entry.rowId) !== null)
}

export function detectInstalledAllBundle(profileDir) {
  // P3 (v15/v16): exact-segment tail match — a loose substring would
  // false-positive on `dsh-evolution-allowlist`.
  return detectInstalledBundles(profileDir, warnManifest).filter(name => /(?:^|\/)dsh-evolution-all$/.test(String(name).trim()))
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
  const mode = normalizeMode(options.mode ?? 'all')
  if (!MODES.has(mode)) throw new Error(`unknown mode ${mode}; expected one of ${[...MODES].join(', ')} (or the product names variant/attach)`)
  // W11 §30.16: 0.48 ships only the two product forms. agent/layered/oneclick are
  // reverse-only; their install paths and the installer-side preset composer are gone.
  if (mode !== 'all' && mode !== 'host') {
    throw new Error(`install-layered: mode "${mode}" was removed in 0.48; only --mode all (default) or --mode host installs. Legacy modes are accepted only by --uninstall.`)
  }
  const home = options.home ?? resolveHome(options.env)
  const profile = options.profile ?? 'web'
  const dryRun = options.dryRun === true
  const force = options.force === true
  const profileDir = profileDirectory(home, profile)
  const profileReady = !dryRun
  const priorJournal = await readInstallJournal(profileDir)
  const result = {
    mode,
    form: deploymentFormOf(mode),
    home,
    profile,
    profileDir,
    copied: [],
    missingEntrypoints: [],
    bundle: null,
  }

  if (mode === 'all') {
    // A legacy preset row or one-click bundle mounts the same model rows at profile root.
    const targetPatchPath = profilePatchPath(home, profile)
    const targetPatch = existsSync(targetPatchPath) ? await readFile(targetPatchPath, 'utf8') : ''
    const existingPresets = profilePresetRows(targetPatch)
    if (existingPresets.length > 0 && !force) {
      throw new Error(`install-layered: profile "${profile}" carries a legacy Evolution preset row (${existingPresets.map(entry => `${entry.base} -> ${entry.rowId}`).join(', ')} in ${targetPatchPath}) and evolution-all mounts the same model rows at profile root. Remove the preset row first (0.47 or --uninstall --mode layered), or pass --force explicitly.`)
    }
    const existingPresetBundle = detectInstalledBundles(profileDir, warnManifest)
      .filter(name => /(?:^|\/)dsh-evolution-preset$/.test(String(name).trim()))
    if (existingPresetBundle.length > 0 && !force) {
      throw new Error(`install-layered: profile "${profile}" carries the legacy one-click preset bundle (${existingPresetBundle.join(', ')}); evolution-all mounts the same model rows at profile root (E-33). Remove it first or pass --force explicitly.`)
    }
  }

  const bundleName = mode === 'all' ? BUNDLES.all : BUNDLES.host
  const installedAll = detectInstalledAllBundle(profileDir)
  if (mode !== 'all' && installedAll.length > 0) {
    throw new Error(`install-layered: profile "${profile}" already carries an evolution-all bundle (${installedAll.join(', ')}). evolution-all is the DEFAULT full-functionality install; host would double-mount its infra rows. Uninstall all first.`)
  }
  // E-33: host and the legacy one-click preset bundle are mutually exclusive.
  const other = BUNDLES.oneclick
  const otherTail = other.slice(other.lastIndexOf('/') + 1)
  const manifestPath = join(profileDir, 'package.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const existing = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    if (existing.some(entry => typeof entry === 'string' && (entry === other || entry.endsWith(`/${otherTail}`)))) {
      throw new Error(`install-layered: profile "${profile}" already carries the ${other} bundle; host and the legacy preset are mutually exclusive (E-33). Uninstall it first.`)
    }
    if (mode === 'all' && existing.some(entry => typeof entry === 'string' && (entry === BUNDLES.host || entry.endsWith('/dsh-evolution-host')))) {
      throw new Error(`install-layered: profile "${profile}" already carries the host bundle; evolution-all and host cannot co-exist. Uninstall host first.`)
    }
  }

  result.bundle = bundleName
  if (profileReady) await ensureProfile(home, profile)
  result.copied = await copyAllEvolutionPackages(profileDir, dryRun)
  if (!dryRun) {
    const dependencyInfo = await installBundlePackage(profileDir, bundleName)
    await writeInstallJournal(profileDir, {
      version: 1,
      scope: EVOLUTION_SCOPE,
      bundle: result.bundle,
      dependencyAdded: dependencyInfo.addedDependency === true,
      dependencyRange: dependencyInfo.dependencyRange,
      copied: result.copied.map(entry => entry.packageName),
      agentPreset: priorJournal?.agentPreset === true,
      agentPresetRows: Array.isArray(priorJournal?.agentPresetRows) ? priorJournal.agentPresetRows : [],
      at: new Date().toISOString(),
    })
  }
  result.missingEntrypoints = missingEntrypoints(result.copied)
  return result
}

/** Flag table for `--help` and for the INSTALL.md parity fixture (G2/S2.3).
 * Every flag the parser accepts appears here exactly once, with its value kind. */
export const INSTALL_FLAGS = [
  { flag: '--mode', value: '<all|host>', summary: 'install plane (default all); legacy agent/layered/oneclick are accepted only by --uninstall' },
  { flag: '--profile', value: '<name>', summary: 'profile directory under $DSH_HOME/profiles (default web)' },
  { flag: '--base', value: '<name>[,<name>...]', summary: 'uninstall-only: narrow legacy preset-row removal to these bases (repeatable)' },
  { flag: '--home', value: '<dir>', summary: 'harness home to write into (default $DSH_HOME)' },
  { flag: '--from-dist', value: '<dir>', summary: 'install the packed tarballs from a prepare-release dist directory (packed-install guard; no build step needed)' },
  { flag: '--dry-run', value: '', summary: 'report what would change and write nothing' },
  { flag: '--force', value: '', summary: 'proceed past a conflicting install form' },
  { flag: '--uninstall', value: '', summary: 'remove a legacy install and its preset rows' },
  { flag: '--help', value: '', summary: 'print this table and exit' },
]

/** @returns {string} the usage block `--help` prints. */
export function usageText() {
  const width = Math.max(...INSTALL_FLAGS.map(entry => entry.flag.length + entry.value.length + 1))
  const rows = INSTALL_FLAGS.map(entry => {
    const left = (entry.flag + ' ' + entry.value).trim().padEnd(width)
    return '  ' + left + '  ' + entry.summary
  })
  return [
    'usage: node install-layered.mjs [flags]',
    '',
    ...rows,
  ].join('\n')
}

function parseArgs(argv) {
  // W11 C: the documented default (INSTALL_FLAGS/INSTALL.md) is all. The old `layered` default was
  // a second product decision that the library default (`options.mode ?? 'all'`) never observed.
  const options = { mode: 'all', profile: 'web', bases: [] }
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
    // `--base` selects the platform agent preset the generated family preset
    // follows. Omitted means the historical `standard` base via
    // resolveAgentPresetBase's default — never a per-call-site default.
    // `--base` repeats and accepts a comma list (v41: one install covers every
    // platform composition the user switches between) — `bases` is the
    // selection, while `base` stays the single-name API the library callers use.
    else if (arg === '--base') options.bases.push(next())
    // The same normalization `$DSH_HOME` gets: PowerShell/cmd do NOT expand a literal `~` for a
  // native command, so `resolve('~/.dsh')` used to install into `<cwd>/~/.dsh` — a tree no runtime
  // reads (G6 review, P2).
  else if (arg === '--home') options.home = resolveHome({ ...process.env, DSH_HOME: next() })
    // `--from-dist` is parsed once at module load (it decides which composer the process imports);
    // the parser only consumes its value so it is not read as an unknown argument. There is no
    // second, dead `options.fromDist` that library callers could believe in (audit 06 P0-2).
    else if (arg === '--from-dist') next()
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--uninstall') options.uninstall = true
    else if (arg === '--help') options.help = true
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
    // G2/S2.3: a real help surface. Before this, `--help` was an unknown argument
    // and threw, so the flag table had no single home to diff against INSTALL.md.
    if (options.help) {
      console.log(usageText())
    } else if (options.uninstall) {
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
      console.log(`form:     ${result.form}`)
      console.log(`profile:  ${result.profile} (${result.profileDir})`)
      if (result.bundle) console.log(`bundle:   ${result.bundle}`)
      console.log(`copied:   ${result.copied.length} evolution packages`)
      if (result.missingEntrypoints.length > 0) {
        console.log(`unbuilt:  ${result.missingEntrypoints.length} packages lack lib/index.js — build them first, or boot the profile with a TS loader`)
      }
      if (options.dryRun) console.log('dry-run:  no files were written')
    }
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
