#!/usr/bin/env node
/**
 * One-click local installer for the layered dsh-evolution installation.
 *
 * Modes:
 *   host     install @deepseek-ai/dsh-evolution-host as a profile bundle
 *   agent    install the Evolution agent preset ROW into the profile's own patch
 *            ($DSH_HOME/profiles/<p>/cordis.patch.yml; --base ptc picks another base)
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
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const MODES = new Set(['host', 'agent', 'layered', 'oneclick'])
// 0.3.77 (C axis): the two PRODUCT forms get first-class names. `variant` is
// the session-level opt-in layout (host bundle + generated preset = the
// historical `layered`); `attach` mounts everything on the original presets
// (= `oneclick`). The old names stay valid; one normalizer so a library caller
// and the CLI cannot disagree about which mode was asked for.
const MODE_ALIASES = new Map([['variant', 'layered'], ['attach', 'oneclick']])
const normalizeMode = (mode) => MODE_ALIASES.get(mode) ?? mode
/** The product form a mode installs: ① variant / ② attach / infra-only / preset-only. */
function deploymentFormOf(mode) {
  if (mode === 'layered') return 'variant'
  if (mode === 'oneclick') return 'attach'
  if (mode === 'host') return 'host-only'
  return 'preset-only'
}
// v43 audit (S1-2): the allowlist moved to lib-family-packages.mjs so this
// installer and verify-package-discovery.mjs read ONE array. A local copy here
// let a new package be published while the installer silently ignored it.
import { EVOLUTION_BUNDLE_TAILS, EVOLUTION_PREFIXES } from './lib-family-packages.mjs'
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
    const stagingManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const stagingVersion = stagingManifest.version
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
    // PLAN S5.8 (2026-09-16, audit P2-26): the staging scope must equal the
    // scope this install resolves names under. The version check alone passed
    // a staging whose package names were rewritten for @deepseek-ai to an
    // EVOLUTION_SCOPE=@lmzhen install (and vice versa) — every copied
    // manifest/dependency then names a package the profile never mounted.
    // Missing field = pre-S5.8 staging: refused with the same strength as a
    // stale version (a scope we cannot verify is a scope we cannot install).
    const stagingScope = stagingManifest.scope
    if (typeof stagingScope !== 'string' || stagingScope === '') {
      throw new Error(`scoped installer: ${manifestPath} has no "scope" field — this staging predates scope recording and cannot be scope-verified; run prepare-release.mjs --scope ${EVOLUTION_SCOPE} to rebuild it`)
    }
    if (stagingScope !== EVOLUTION_SCOPE) {
      throw new Error(`scoped installer: ${STAGING_DIR} was built under scope "${stagingScope}" but EVOLUTION_SCOPE is "${EVOLUTION_SCOPE}" — the staged package names do not match this install's scope. Re-run prepare-release.mjs --scope ${EVOLUTION_SCOPE} to rebuild the staging, or set EVOLUTION_SCOPE=${stagingScope} to install the existing one`)
    }
    return STAGING_DIR
  }
  throw new Error(`scoped installer requires ${STAGING_DIR}; run prepare-release.mjs --scope ${EVOLUTION_SCOPE} first`)
}

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

/**
 * Why this base cannot be installed here, or undefined when it can.
 *
 * A base whose platform composition injects a service the deployment does not
 * provide would mount-refuse at session start; an `unsupported` base has no
 * family landing surface at all. Both are refused at INSTALL time instead, with
 * the reason the platform would have given later. The installer judges
 * `requires.service` from the target profile's bundle rows because it cannot see
 * the runtime service store; `/evolution preset install` asks `ctx.get` for the
 * service itself — the exact reason a mount would refuse. Uninstall does NOT
 * consult this: removing an already-installed variant must stay possible.
 * @param entry - a table entry (name + optional ability fields).
 * @param bundles - the target profile's bundle rows.
 * @returns the refusal text, or undefined when the base is installable here.
 */
export function baseUnavailableReason(entry, bundles = []) {
  if (typeof entry?.unsupported === 'string' && entry.unsupported !== '') {
    return `base "${entry.name}" is registered as UNSUPPORTED: ${entry.unsupported}`
  }
  const service = entry?.requires?.service
  if (typeof service !== 'string' || service === '') return undefined
  const provider = bundles.some(name => String(name).trim().endsWith('dsh-web-app'))
  return provider
    ? undefined
    : `base "${entry.name}" requires the "${service}" service, which only a web-app deployment provides (the target profile mounts no web-app bundle)`
}

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

/** The row id one base's preset occupies in a composition. The platform ships
 * `preset-standard` for id `standard` (`packages/bundle/web-app/presets/standard.patch.yml`), so a
 * family preset id mirrors that spelling. */
export function presetRowId(id) {
  return `preset-${id}`
}

/** The composition identity of one base's row: the row id a profile patch is matched by, plus the
 * preset id and display copy the platform registry serves. */
export function presetIdentity(entry) {
  return { rowId: presetRowId(entry.id), id: entry.id, name: entry.display.name, description: entry.display.description, order: entry.display.order }
}

/** The profile's own patch layer — the file a family preset row is written to
 * (`packages/boot/app-boot/src/profile.ts`, `PROFILE_PATCH_FILENAME`). */
export function profilePatchPath(home, profile = 'web') {
  return join(profileDirectory(home, profile), 'cordis.patch.yml')
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
  // P2-22a (audit): stage the copy into a sibling `.staging-<pid>` directory
  // FIRST, then swap. The former in-place `cp(force)` over a LIVE mounted
  // package tree left a torn/mixed package set behind any mid-copy crash or
  // Windows EPERM/EBUSY while the manifest still mounted the bundle. The
  // swap window is one rm+rename per package; a crash before it leaves the
  // PREVIOUS tree intact plus a `.staging-*` residue the next run removes.
  const staging = `${destination}.staging-${process.pid}`
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
  await rm(destination, { recursive: true, force: true })
  await rename(staging, destination)
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

/** What `DSH_AGENT_PRESET_ROOT` must name: a directory holding the platform base preset patches
 * under their shipped file names (`<base>.patch.yml`) — e.g. a copy of a same-version platform
 * tree's `packages/bundle/web-app/presets/`. The desktop application is the shape that needs it:
 * its platform packages live inside `resources/app.asar`, so no plain
 * `node_modules/@deepseek-ai/dsh-web-app/presets/` exists on disk. */
export const AGENT_PRESET_ROOT_HINT = 'point DSH_AGENT_PRESET_ROOT at a directory holding <base>.patch.yml (copy it out of a same-version dsh tree: packages/bundle/web-app/presets/)'

/** The platform bundle that ships the base preset patches
 * (`presets/*.patch.yml` in its `files`/`exports` and `dsh.bundle.patch`). */
const PLATFORM_BUNDLE_PACKAGE = '@deepseek-ai/dsh-web-app'

/** The Electron resource layouts a desktop installation exposes its unpacked packages under. */
const DESKTOP_RESOURCE_SHAPES = [
  ['resources', 'app.asar.unpacked'],
  ['resources', 'app', 'resources', 'app.asar.unpacked'],
]

/** Subdirectories of one directory, or none when it does not exist: a missing level is an ordinary
 * miss on a candidate walk, not a failure. */
function listDirectories(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    return []
  }
}

/** Installation roots a desktop/Electron tree may sit at. */
function desktopInstallRoots(fromDir) {
  const roots = []
  const localAppData = process.env.LOCALAPPDATA
  if (process.platform === 'win32' && localAppData) roots.push(join(localAppData, 'Programs', 'DeepSeek Harness'))
  for (let level = fromDir; level !== dirname(level); level = dirname(level)) {
    if (existsSync(join(level, 'resources', 'app.asar.unpacked'))) roots.push(level)
  }
  return roots
}

/** Every `@deepseek-ai/dsh-*` preset patch under one unpacked Electron resource root. */
function probeDesktopScope(resourceRoot, file, probes) {
  const scopeRoot = join(resourceRoot, 'dsh', 'node_modules', '@deepseek-ai')
  for (const name of listDirectories(scopeRoot)) {
    if (!name.startsWith('dsh-')) continue
    const path = join(scopeRoot, name, 'presets', file)
    probes.push(path)
    if (existsSync(path)) return path
  }
  return undefined
}

/**
 * Resolve the platform PATCH FILE one agent-preset BASE names.
 *
 * 0.2.x replaced the preset directory with a declarative row, and the base a
 * family row is merged into is the bundle patch layer that declares it
 * (`packages/bundle/web-app/presets/<base>.patch.yml`, listed in that package's
 * `dsh.bundle.patch`). `base` is already validated by
 * {@link resolveAgentPresetBase}, so an unknown base fails there — never here by
 * silently reading `standard`.
 *
 * Discovery order:
 *   1. `DSH_AGENT_PRESET_ROOT` (explicit; an ANSWER, not the head of a chain);
 *   2. the target profile's own `node_modules/<bundle>/presets/` — the bundles
 *      that profile actually mounts;
 *   3. the desktop/Electron installation tree, whose only readable form is the
 *      unpacked resource scope (`<install>/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/`,
 *      each `dsh-<name>/presets/` directory under it) — the platform packages
 *      themselves are inside `app.asar`;
 *   4. walking up from this script: every `presets/` directory of a checkout's
 *      bundle packages, then every `@deepseek-ai/dsh-<name>/presets/` directory
 *      of an installed tree;
 *   5. the global npm root (`%APPDATA%/npm/node_modules` on Windows, `npm root -g`
 *      elsewhere), in the nested `dsh/node_modules/@deepseek-ai/dsh-*` form npm
 *      produces and the sibling form.
 *
 * Fails loud otherwise, naming EVERY probed shape and the one escape that always
 * works: a base composed from another base's rows would mount rows the user did
 * not ask for, with nothing in the output saying so.
 * @param base - the base name (the preset patch's file stem).
 * @param profileDir - the target profile directory, or undefined.
 * @param bundles - bundle package names the target profile mounts.
 * @returns the patch file's absolute path.
 */
async function resolveBasePresetPatch(base, profileDir, bundles = []) {
  const file = `${base}.patch.yml`
  const probes = []
  const probe = (path) => {
    probes.push(path)
    return existsSync(path) ? path : undefined
  }

  // An explicit root is an ANSWER, not the head of a fallback chain: an operator
  // pointing the installer at one tree must never get another tree's rows under
  // the requested base.
  const explicit = process.env.DSH_AGENT_PRESET_ROOT?.trim()
  if (explicit) {
    const path = join(explicit, file)
    if (!existsSync(path)) {
      throw new Error(`install-layered: DSH_AGENT_PRESET_ROOT is set but ${path} does not exist — ${AGENT_PRESET_ROOT_HINT}`)
    }
    return path
  }

  if (profileDir !== undefined && existsSync(profileDir)) {
    for (const name of new Set([PLATFORM_BUNDLE_PACKAGE, ...bundles])) {
      const found = probe(join(profileDir, 'node_modules', ...name.split('/'), 'presets', file))
      if (found !== undefined) return found
    }
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url))
  // Walk upward from this script: mirror layout (packages/scripts) and the
  // upstream overlay layout (packages/evolution/scripts) both reach the tree
  // root within a few levels.
  for (let level = scriptDir; level !== dirname(level); level = dirname(level)) {
    const bundleRoot = join(level, 'packages', 'bundle')
    for (const name of listDirectories(bundleRoot)) {
      const found = probe(join(bundleRoot, name, 'presets', file))
      if (found !== undefined) return found
    }
    const scopeRoot = join(level, 'node_modules', '@deepseek-ai')
    for (const name of listDirectories(scopeRoot)) {
      if (!name.startsWith('dsh-')) continue
      const found = probe(join(scopeRoot, name, 'presets', file))
      if (found !== undefined) return found
    }
  }

  // The desktop installation tree is probed LAST (0.2.x G6 review, P2): it is a copy of SOME
  // platform version, while the tree this script lives in is the one the profile is being built
  // against. Eager desktop roots composed a family preset from another tree's rows.
  for (const root of desktopInstallRoots(dirname(fileURLToPath(import.meta.url)))) {
    for (const shape of DESKTOP_RESOURCE_SHAPES) {
      const resourceRoot = join(root, ...shape)
      const found = probe(join(resourceRoot, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', file))
        ?? probeDesktopScope(resourceRoot, file, probes)
      if (found !== undefined) return found
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
          // The npm GLOBAL shape: the platform packages are DEPENDENCIES of the
          // CLI package, so npm nests them under `dsh/node_modules/...`; the
          // sibling form below only exists when they were installed separately.
          join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', file),
          join(root, '@deepseek-ai', 'dsh-web-app', 'presets', file),
        ]) {
          const found = probe(candidate)
          if (found !== undefined) return found
        }
      }
    } else {
      // R-08 (V10): `npm` is a PATH executable on POSIX and the Windows branch
      // above never reaches this line, so spawn it shell-free like every other
      // child process in this script (shell: true re-introduced the injection
      // surface and quoting hazards the rest of the file deliberately avoids).
      const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
      for (const candidate of [
        join(globalRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', file),
        join(globalRoot, '@deepseek-ai', 'dsh-web-app', 'presets', file),
      ]) {
        const found = probe(candidate)
        if (found !== undefined) return found
      }
    }
  } catch {
    // npm root -g is unavailable; fall through to the loud error below.
  }

  throw new Error(
    `install-layered: cannot find the runtime platform '${base}' preset patch — no candidate carries `
    + `presets/${file}. A base with no runtime patch is refused rather than composed from another `
    + `base: the generated preset must follow the platform it runs on. Probed (in order): ${probes.join(', ')}. `
    + `On a desktop install the platform packages live inside resources/app.asar, so no plain file `
    + `exists — ${AGENT_PRESET_ROOT_HINT}.`,
  )
}

/**
 * The row list a platform base preset patch carries under `config.plugins`, dedented to column 0.
 *
 * Twin of core's `basePresetPlugins` (`evolution-core/src/preset-composition.ts`; the parity case
 * in `evolution-core/tests/preset-composition.spec.ts` pins the bytes). The preset's own list is
 * the SHALLOWEST `plugins:` line: a child row may carry a key by that name far deeper.
 * @param patchText - the base preset patch file's text.
 * @returns the plugin rows, dedented and newline-terminated.
 */
export function basePresetPlugins(patchText) {
  const lines = patchText.split('\n')
  let at = -1
  let indent = Number.POSITIVE_INFINITY
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)plugins:\s*$/.exec(lines[index] ?? '')
    const width = match?.[1]?.length
    if (width === undefined) continue
    if (width < indent) {
      indent = width
      at = index
    }
  }
  if (at < 0) throw new Error('install-layered: the base preset patch carries no `plugins:` list')
  const block = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') {
      block.push(line)
      continue
    }
    if (line.length - line.trimStart().length <= indent) break
    block.push(line)
  }
  while (block.length > 0 && block[block.length - 1]?.trim() === '') block.pop()
  const widths = block.filter(line => line.trim() !== '').map(line => line.length - line.trimStart().length)
  const dedent = widths.length === 0 ? 0 : Math.min(...widths)
  return block.map(line => line.slice(0, dedent).trim() === '' ? line.slice(dedent) : line).join('\n') + '\n'
}

/** The platform package a DECLARATIVE preset row names (0.2.x replaced preset directories with it). */
export const AGENT_PRESET_PACKAGE = '@deepseek-ai/dsh-agent-preset'

/**
 * The declarative preset row for one base: the platform base rows plus the family delta, under
 * `config.plugins`, with the row id `mergePresetRow` matches by.
 *
 * Twin of core's `composePresetRow`. The override anchors are defined against a column-0 `- id:`
 * row, so {@link generateAgentPreset} runs first and the indentation that puts the rows under
 * `plugins:` comes last.
 * @param baseComposition - the platform base rows (from {@link basePresetPlugins}).
 * @param deltaComposition - the family delta rows.
 * @param identity - row id, preset id, display fields and order.
 * @returns the row text, newline-terminated.
 */

/**
 * Drop the blank lines that merely separate block-sequence items, keeping the ones INSIDE a block
 * literal (`key: |` / `>`): there a blank line is part of the value, and filtering it flattened a
 * platform base preset's multi-paragraph prompt into one paragraph (G6 review, P1).
 * @param text - the composition rows.
 * @returns the rows with the separating blank lines removed.
 */
function denseBlockSequence(text) {
  const out = []
  let scalarIndent = -1
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const indent = line.length - line.trimStart().length
    if (scalarIndent >= 0 && trimmed !== '' && indent <= scalarIndent) scalarIndent = -1
    if (scalarIndent < 0) {
      const match = /^(\s*)[\w".-]+:\s*[|>]/.exec(line)
      if (match !== null) scalarIndent = (match[1] ?? '').length
    }
    if (trimmed === '' && scalarIndent < 0) continue
    out.push(line)
  }
  return out.join('\n')
}

export function composePresetRow(baseComposition, deltaComposition, identity) {
  const composed = generateAgentPreset(baseComposition, deltaComposition)
  const plugins = denseBlockSequence(composed)
    .split('\n')
    // A kept blank line stays BLANK: indenting it would add trailing spaces to a block scalar's
    // value (the shape the platform's own base patches use is a truly empty line).
    .map(line => (line === '' ? '' : '      ' + line))
    .join('\n')
  return [
    '- id: ' + identity.rowId,
    "  name: '" + AGENT_PRESET_PACKAGE + "'",
    '  config:',
    '    id: ' + identity.id,
    // No trailing commas: the row is YAML, and the platform's own patch parser
    // rejects a JSON-style comma after a block mapping entry (pinned by the parse
    // case in evolution-host/tests/installer-preset-base.spec.ts). Byte-identical
    // with core's composePresetRow.
    '    name: ' + JSON.stringify(identity.name),
    '    description: ' + JSON.stringify(identity.description),
    '    order: ' + String(identity.order),
    '    plugins:',
    plugins,
    '',
  ].join('\n')
}

/**
 * Wrap a composed row as the patch entry a profile patch needs.
 *
 * A plain patch entry OVERRIDES the row with the same id and adds nothing, so a preset the platform
 * does not ship has to arrive inside an `insert` entry
 * (`packages/boot/app-boot/tests/user-patches.spec.ts:47-64`).
 * @param row - the row text, as {@link composePresetRow} returns it.
 * @returns the patch entry text, newline-terminated.
 */
export function composePresetInsert(row) {
  const body = row.replace(/\s+$/, '').split('\n').map(line => '    ' + line).join('\n')
  return `- insert:\n${body}\n`
}

/**
 * The patch entry a profile patch receives for one base: the platform base rows, the family delta,
 * and the wrapper. Twin of core's `composePresetEntry`.
 * @param basePatchText - the platform base preset patch's text.
 * @param deltaComposition - the family delta rows.
 * @param identity - row id, preset id, display fields and order.
 * @returns the patch entry text, newline-terminated.
 */
export function composePresetEntry(basePatchText, deltaComposition, identity) {
  return composePresetInsert(composePresetRow(basePresetPlugins(basePatchText), deltaComposition, identity))
}

/**
 * The span of one row id: the enclosing column-0 list item and the row's own first line.
 *
 * An installer-written row sits inside `- insert:` (four spaces deeper); a row the Web editor saved
 * is that column-0 item itself. Both are replaced whole, so the span reaches back to the enclosing
 * item and forward to the next one.
 * @param lines - the patch text's lines.
 * @param rowId - the row id to locate.
 * @returns the span, or null when the patch carries no such row.
 */
function rowBlockSpan(lines, rowId) {
  const rowRe = new RegExp('^\\s*- id:\\s*' + rowId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')
  const rowStart = lines.findIndex(line => rowRe.test(line))
  if (rowStart < 0) return null
  let start = rowStart
  while (start > 0 && !/^- /.test(lines[start] ?? '')) start -= 1
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^- /.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  return { start, end, rowStart }
}

/** The text of one row's own patch item, or null when the patch carries no such row — the
 * comparison unit for {@link checkAgentPresetFreshness}. Twin of core's `presetRowBlock`. */
export function presetRowBody(block) {
  const lines = block.split('\n')
  if (!/^- insert:\s*$/.test(lines[0] ?? '')) return block
  return lines.slice(1).map(line => (line.startsWith('    ') ? line.slice(4) : line)).join('\n')
}

/** The row body of a patch block, `- insert:` unwrapped — the unit a freshness comparison needs
 * (twin of core's `presetRowBody`): a block found at column 0 and a generated `- insert:` entry
 * describe the same row and must compare equal (G6 review, P2). */
export function presetRowBlock(patchText, rowId) {
  const lines = patchText.split('\n')
  const span = rowBlockSpan(lines, rowId)
  if (span === null) return null
  const block = lines.slice(span.start, span.end)
  while (block.length > 0 && (block[block.length - 1] ?? '').trim() === '') block.pop()
  return block.join('\n') + '\n'
}

/** The empty patch list the platform seeds a profile patch with. */
export const EMPTY_PATCH_SEED = '[]'

/** The seed in any spelling the platform accepts (`[]`, `[ ]`, `[] # empty`). */
const EMPTY_PATCH_SEED_RE = /^\s*\[\s*\](\s*#.*)?\s*$/

/** Drop trailing blank lines only: a kept line's own terminator (a CRLF file's `\r`) is never touched. */
function trimTrailingBlankLines(lines) {
  const out = [...lines]
  while (out.length > 0 && (out[out.length - 1] ?? '').trim() === '') out.pop()
  return out
}

/** The text to write when a patch is left with no entries: the platform's own seed
 * (`packages/boot/app-boot/src/profile.ts`, `PROFILE_PATCH_FILENAME`), never a zero-byte file. */
export function presetPatchText(patchText) {
  return patchText.trim() === '' ? `${EMPTY_PATCH_SEED}\n` : patchText
}

/**
 * Merge one generated entry into a patch (a profile patch) by row id.
 *
 * Idempotent by construction: an existing row with the same `- id:` is REPLACED whole — its block
 * is the enclosing column-0 list item, so an installer-written row inside `- insert:` and a
 * Web-editor-saved row at column 0 are both matched by {@link rowBlockSpan} — and anything else in
 * the patch stays byte-identical, because the patch usually carries rows this installer knows
 * nothing about. A missing row is appended; the platform's empty-list seed `[]` is REPLACED rather
 * than extended (a block sequence appended after a complete flow sequence is not parsable YAML).
 * @param patchText - the current patch text (`''` for a fresh one).
 * @param row - the entry text, as {@link composePresetEntry} returns it.
 * @param rowId - the row id to replace or append.
 * @returns the merged patch text, newline-terminated.
 */
export function mergePresetRow(patchText, row, rowId) {
  const lines = patchText.split('\n')
  const block = row.replace(/\s+$/, '').split('\n')
  const span = rowBlockSpan(lines, rowId)
  if (span === null) {
    // Only the SEAM is normalized. The platform seed (`[]`, `[ ]`, `[] # empty`) is a COMPLETE flow
    // sequence a block sequence may not follow, so that one line goes; every other byte the author
    // wrote stays — a blank line inside a block scalar (`section: |`) is part of the VALUE, and
    // filtering the whole file rewrote user content on install (G6 review, P1).
    const seedIndex = lines.findIndex(line => EMPTY_PATCH_SEED_RE.test(line))
    const base = seedIndex >= 0 ? [...lines.slice(0, seedIndex), ...lines.slice(seedIndex + 1)] : [...lines]
    const kept = trimTrailingBlankLines(base)
    return (kept.length === 0 ? block : [...kept, ...block]).join('\n') + '\n'
  }
  const merged = [...lines.slice(0, span.start), ...block, ...lines.slice(span.end)]
  // Same byte discipline on the replace path: no global blank-line collapsing, and no `\s+$` trim
  // (it ate the trailing \r of a CRLF file's last line).
  return trimTrailingBlankLines(merged).join('\n') + '\n'
}

/**
 * Remove one row from a patch, taking its `- insert:` item with it when that item holds nothing
 * else (an empty insert entry is left-over structure the platform would keep parsing).
 * @param patchText - the patch text to edit.
 * @param rowId - the row id to remove.
 * @returns the patch text, newline-terminated; byte-identical when the id is absent.
 */
export function removePresetRow(patchText, rowId) {
  const lines = patchText.split('\n')
  const span = rowBlockSpan(lines, rowId)
  if (span === null) return patchText
  const rowLine = lines[span.rowStart] ?? ''
  const rowIndent = rowLine.length - rowLine.trimStart().length
  const nested = rowIndent > 0
  const siblings = lines.slice(span.start + 1, span.end).filter((line) => {
    const width = line.length - line.trimStart().length
    return width === rowIndent && line.trimStart().startsWith('- ')
  }).length
  // A nested row inside an entry that holds others is removed alone — before it
  // or after it alike; the entry itself goes when it held nothing else.
  const cut = nested && siblings > 1
    ? { start: span.rowStart, end: rowSiblingEnd(lines, span.rowStart, span.end) }
    : span
  const kept = [...lines.slice(0, cut.start), ...lines.slice(cut.end)]
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  return text === '' ? '' : text + '\n'
}

/** The end of one nested row's own block inside a patch entry.
 * @param lines - the patch text's lines.
 * @param rowStart - the row's `- id:` line.
 * @param itemEnd - the enclosing item's end.
 * @returns the index of the next sibling row, or the item's end. */
function rowSiblingEnd(lines, rowStart, itemEnd) {
  const indent = (lines[rowStart] ?? '').length - (lines[rowStart] ?? '').trimStart().length
  for (let index = rowStart + 1; index < itemEnd; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const width = line.length - line.trimStart().length
    if (width === indent && line.trimStart().startsWith('- ')) return index
    if (width < indent) return index
  }
  return itemEnd
}

/**
 * Row id set of a composition fragment — lightweight line parse, no YAML
 * library (v2 §10 scope control). Only `- id:` rows count; a row whose id
 * appears in BOTH fragments would mount twice in the generated composition.
 *
 * PLAN S5.9 (2026-09-16, audit P2-27): the id extraction accepts INDENTED
 * `- id:` rows too, so a collision hidden in a nested group is still caught —
 * the old `^- id:` anchored at column 0 and was blind to exactly the rows an
 * upstream group nesting would produce. Boundary (current, deliberate):
 * DETECTION covers nested rows, while the override INJECTION anchors
 * (`applyRowOverride` below) still match top-level rows only — the injection
 * indent contract (`^ {2}key:`) is defined against a column-0 row.
 */
function rowIds(composition) {
  const ids = new Set()
  for (const line of composition.split('\n')) {
    const match = /^\s*- id:\s*(\S+)/.exec(line)
    if (match) ids.add(match[1])
  }
  return ids
}

/**
 * Compose the runtime platform base rows with the evolution delta. The BASE is
 * the caller's business (`resolveBasePresetPatch` reads the base's patch from the
 * AGENT_PRESET_BASES table, and `basePresetPlugins` dedents its row list); this
 * function sees only the two text fragments, so it composes every base
 * identically. The delta stays the only evolution-owned text, so the preset
 * tracks every platform version.
 *
 * N-5 collision guard: an id present in BOTH fragments would mount twice
 * (worse, the duplicate could shadow the platform row). Fails loud; the
 * `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1` escape lets an upstream that absorbs
 * a delta row into the platform composition transition (warn + keep both,
 * mounting twice).
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
 * V10-14 (P1-2), 0.3.77: apply the SHARED override table to the composed
 * preset — `evolution-core/row-overrides.json`, the same file core's composer
 * reads. The cap lands on the STANDARD-sourced `- id: tool-skill` row.
 *
 * The session-visible `tool-skill` instance mounts in the agent preset's own
 * standing scope; a profile-root patch (evolution-host/cordis.patch.yml)
 * cannot reach it, so before this injection the layered install ran the
 * platform default (500) on the catalog's read side. Text-level rewrite in
 * the same line-scan style as rowIds() above (no YAML library — v2 §10 scope
 * control). 0.3.53: generateAgentPreset calls this internally; core's
 * composePresetComposition applies the same table, so the npm
 * `/evolution preset install` path gets it too (installer.spec pins parity):
 *   - idempotent: a tool-skill item that already carries a `config:` key is
 *     left byte-identical, so re-running the installer never doubles the key;
 *   - the injected block carries a marker comment so a diff of the generated
 *     preset can tell installer-owned text from platform text;
 *   - a composition WITHOUT a tool-skill row is returned unchanged with a
 *     one-time warning (a renamed platform row must not brick the install,
 *     but the missed cap must be observable).
 */
/** The override table, read from the SAME file core's composer reads. The
 * installer is a source-tree tool: it reads the JSON directly rather than
 * importing the built core package, so no build is needed to install. */
const ROW_OVERRIDES_PATH = join(PACKAGES_DIR, 'evolution-core', 'row-overrides.json')

function readRowOverrides() {
  const parsed = JSON.parse(readFileSync(ROW_OVERRIDES_PATH, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`install-layered: ${ROW_OVERRIDES_PATH} must be an array of override entries`)
  }
  return parsed
}

export function injectToolSkillCap(composition) {
  let lines = composition.split('\n')
  // One table, two generation paths (0.3.77): before this, both sides kept their
  // own copy of the entries below and stayed byte-identical only by hand.
  for (const override of readRowOverrides()) {
    lines = applyRowOverride(lines, override)
  }
  return lines.join('\n')
}

function applyRowOverride(lines, override) {
  const rowRe = new RegExp('^- id:\\s*' + override.row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')
  let found = false
  for (let i = 0; i < lines.length; i += 1) {
    if (!rowRe.test(lines[i] ?? '')) continue
    found = true
    // Walk the item's continuation lines (indented) up to the next item or
    // top-level line; a blank line terminates the item block.
    let end = i
    let hasKey = false
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? ''
      if (next.trim() === '') break
      if (!/^\s/.test(next)) break
      // v22 (PRE-3): anchor the child key to the item's own child indent (two
      // spaces) — byte-identical with core's applyOneOverride. The old `\s+`
      // form matched the key at any depth, silently skipping the injection when
      // a platform preset grew nested maps.
      if (new RegExp('^ {2}' + override.key + ':(\\s|$)').test(next)) hasKey = true
      end = j
    }
    if (hasKey) continue
    lines.splice(end + 1, 0, ...override.lines)
    i = end + override.lines.length
  }
  if (!found) {
    console.warn('install-layered: warning — ' + override.missingReason)
  }
  return lines
}

/** The delta fragment a run composes: the packaged `evolution-agent/agent.cordis.yml`, or the
 * `DSH_EVOLUTION_DELTA_PATH` override tests and one-off builds use. */
function agentDeltaPath() {
  return process.env.DSH_EVOLUTION_DELTA_PATH?.trim() || join(packageSourceRoot(), 'evolution-agent', 'agent.cordis.yml')
}

/**
 * Write one base's preset ROW into the target profile's own patch layer.
 *
 * 0.2.x replaced the preset directory with a declarative composition row
 * (`packages/preset/agent-preset/src/index.ts`), so the deliverable is an
 * `- insert:` entry in `profiles/<p>/cordis.patch.yml` — the same file the
 * platform's Web editor saves preset edits to
 * (`packages/boot/app-boot/src/profile.ts`, `PROFILE_PATCH_FILENAME`).
 *
 * V10-14 (P1-2): the cap injection runs INSIDE composePresetEntry (on the
 * COMPOSED rows, after the collision guard) — core `composePresetRow` applies
 * the byte-identical rule and `evolution-core/tests/preset-composition.spec.ts`
 * pins the parity. The rule holds for EVERY base: the PTC preset carries its own
 * config-less `tool-skill` row, so the injection is base-agnostic.
 *
 * The `already current` and `exists` results are reported identically in
 * dry-run and real mode — a dry-run always claiming installed:true hides a
 * skipped write (F-354). Only the write itself is skipped in dry-run.
 * @param home - the resolved DSH_HOME.
 * @param profile - the target profile name.
 * @param dryRun - report without writing.
 * @param force - overwrite a row that is not a fresh generation.
 * @param basePatchPath - the platform base preset patch this run composes.
 * @param base - the base name.
 * @returns the row's report: `{ patchPath, rowId, presetId, installed, reason? }`.
 */
async function installAgentPreset(home, profile, dryRun, force, basePatchPath, base) {
  const entry = resolveAgentPresetBase(base)
  const identity = presetIdentity(entry)
  const patchPath = profilePatchPath(home, profile)
  const deltaComposition = await readFile(agentDeltaPath(), 'utf8')
  const basePatchText = await readFile(basePatchPath, 'utf8')
  const current = existsSync(patchPath) ? await readFile(patchPath, 'utf8') : ''
  const merged = mergePresetRow(current, composePresetEntry(basePatchText, deltaComposition, identity), identity.rowId)
  const report = { patchPath, rowId: identity.rowId, presetId: identity.id, installed: false }
  // `already current` is the idempotent re-run: the block on disk IS what a fresh
  // generation writes, so the row is the family's and nothing needs to move.
  if (merged === current) return { ...report, reason: 'already current' }
  // A block that differs is a snapshot only the user can decide to replace —
  // the same posture `--check-presets` takes.
  if (!force && presetRowBlock(current, identity.rowId) !== null) {
    return { ...report, reason: 'exists; use --force to overwrite' }
  }
  if (!dryRun) {
    // The patch file and its directory are part of the deliverable now: seed
    // them the way the platform does (`[]` + the profile template).
    await ensureProfile(home, profile)
    await writeManifestAtomic(patchPath, merged)
  }
  return { ...report, installed: true }
}

/**
 * G3-①: does the installed preset ROW still describe THIS platform?
 *
 * A generated row is an INSTALL-TIME SNAPSHOT: it embeds the platform rows of
 * the day it was written, so a platform change or a family upgrade leaves a
 * block silently describing a platform that no longer exists. This recomputes
 * what a fresh install would write and compares it with the block in the
 * profile patch. It never repairs: overwriting a snapshot the user may have
 * hand-tuned is a decision only the user can make.
 *
 * A base whose profile patch carries no block is `absent` and is never
 * resolved: the base patch is read only when there is something to compare.
 * @param options - `home`/`env` resolved like the other entry points, `profile` (default 'web').
 * @returns one `{ base, id, patchPath, status }` record per INSTALLABLE base.
 */
export async function checkAgentPresetFreshness(options = {}) {
  const home = options.home ?? resolveHome(options.env)
  const profile = options.profile ?? 'web'
  // The same judgement the install-time refusal makes, on the same rows: a base
  // this deployment cannot install has no fresh install to compare against, so
  // it is SKIPPED rather than reported stale.
  const profileDir = profileDirectory(home, profile)
  // Same reader as the install-time refusal: the family-filtered `detectInstalledBundles` cannot
  // see `dsh-web-app`, so a cordis row used to be skipped here (G6 review, P1).
  const bundles = profileBundleRows(profileDir)
  const patchPath = profilePatchPath(home, profile)
  const patchText = existsSync(patchPath) ? await readFile(patchPath, 'utf8') : ''
  const bases = []
  for (const name of Object.keys(AGENT_PRESET_BASES)) {
    if (baseUnavailableReason({ name, ...AGENT_PRESET_BASES[name] }, bundles) !== undefined) continue
    const entry = resolveAgentPresetBase(name)
    const block = presetRowBlock(patchText, presetRowId(entry.id))
    // `absent` is not an error: the user may simply not have installed this base.
    if (block === null) {
      bases.push({ base: entry.base, id: entry.id, patchPath, status: 'absent' })
      continue
    }
    // Replay the install path READ-ONLY: this base's platform patch plus the
    // same delta (DSH_EVOLUTION_DELTA_PATH honored) through the same composer,
    // compared byte-for-byte with the block in the patch.
    const basePatchText = await readFile(await resolveBasePresetPatch(entry.base, profileDir, bundles), 'utf8')
    const fresh = composePresetEntry(basePatchText, await readFile(agentDeltaPath(), 'utf8'), presetIdentity(entry))
    bases.push({ base: entry.base, id: entry.id, patchPath, status: presetRowBody(fresh) === presetRowBody(block) ? 'fresh' : 'differs' })
  }
  return { bases }
}

export async function uninstall(options = {}) {
  const mode = normalizeMode(options.mode ?? 'layered')
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
function profileBundleRows(profileDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    return bundles.filter(entry => typeof entry === 'string' && entry.trim() !== '')
  } catch {
    return []
  }
}

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
  const mode = normalizeMode(options.mode ?? 'layered')
  if (!MODES.has(mode)) throw new Error(`unknown mode ${mode}; expected one of ${[...MODES].join(', ')} (or the product names variant/attach)`)
  const home = options.home ?? resolveHome(options.env)
  const profile = options.profile ?? 'web'
  const dryRun = options.dryRun === true
  const force = options.force === true

  // The base selection is validated FIRST, before the mode is even acted on: an
  // unknown `--base` must not reach a single write, and it must not fall back
  // to `standard` — the whole point of a variant is that the user asked for a
  // different platform composition. `bases` (CLI) and `base` (library callers)
  // are the same selection; the first entry stays the reported primary base.
  const presetEntries = resolveAgentPresetBases(options.bases !== undefined && options.bases.length > 0 ? options.bases : options.base)
  // G1-② (0.3.78): refuse an uninstallable base BEFORE any mutation, quoting the
  // reason the platform would have given at mount time.
  for (const entry of presetEntries) {
    // Runs before `profileDir` exists as a binding, so it is resolved here; a
    // not-yet-created profile has no bundle rows to read — that is "no web-app",
    // not a crash.
    const bundleDir = profileDirectory(home, profile)
    // The installability judgement asks the SAME question doctor asks (`profileBundles`): which
    // bundles does this profile mount. `detectInstalledBundles` filters to the FAMILY bundle tails,
    // so it can never answer `dsh-web-app` and refused every `--base cordis` install (G6 review, P1).
    const bundles = profileBundleRows(bundleDir)
    const reason = baseUnavailableReason({ name: entry.base, ...AGENT_PRESET_BASES[entry.base] }, bundles)
    if (reason !== undefined) throw new Error(`install-layered: ${reason}`)
  }
  const presetBase = presetEntries[0].base

  const needsHost = mode === 'host' || mode === 'layered'
  const needsAgent = mode === 'agent' || mode === 'layered'
  const needsCompat = mode === 'oneclick'

  // v21 (S-3): resolve the platform base PATCH before any profile mutation — the
  // old order committed bundle rows/copies and only tried to build the preset
  // afterwards, leaving a half-installed profile (host mounted, preset missing)
  // when the resolution failed. Resolution is read-only, and a base with no
  // runtime patch aborts the run here.
  // One patch per selected base: each variant follows the platform rows of ITS
  // base (the ptc variant composes the platform's ptc preset, not the standard
  // one).
  const profileDir = profileDirectory(home, profile)
  const profileReady = !dryRun
  const basePatches = new Map()
  if (needsAgent) {
    const bundles = profileBundleRows(profileDir)
    for (const entry of presetEntries) {
      basePatches.set(entry.base, await resolveBasePresetPatch(entry.base, profileDir, bundles))
    }
  }
  const result = { mode, form: deploymentFormOf(mode), home, profile, profileDir, base: presetBase, bases: presetEntries.map(entry => entry.base), copied: [], missingEntrypoints: [], bundle: null, agentPreset: null, agentPresets: [] }
  // v21 (S-1): the bundle-dependency outcome, recorded onto the journal at the
  // end of the run (null in dry-run — no journal is written then anyway).
  let dependencyInfo = null
  // v23 (BR-3): journal payload builder — called once right after the
  // dependency row (the base record) and once after the preset phase (with
  // the refreshed preset accounting). Reads the mutable closables at call
  // time, so each write describes the state reached so far.
  // The preset record is ROW-scoped (0.2.x): a directory path is not what a
  // later uninstall reads, the patch file and the row id are. Every row this run
  // left carrying a fresh generation — written now, or already byte-identical —
  // is family-owned, which is what `agentPreset` summarizes for the modes that
  // never reach the preset phase.
  const ownedPresetRows = () => result.agentPresets
    .filter(entry => entry.installed === true || entry.reason === 'already current')
    .map(entry => ({ patchPath: entry.patchPath, rowId: entry.rowId, presetId: entry.presetId }))
  const journalPayload = (presetInstalled) => ({
    version: 1,
    scope: EVOLUTION_SCOPE,
    bundle: result.bundle,
    dependencyAdded: dependencyInfo?.addedDependency === true,
    dependencyRange: dependencyInfo?.dependencyRange,
    copied: result.copied.map(entry => entry.packageName),
    agentPreset: presetInstalled,
    agentPresetRows: ownedPresetRows(),
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
    const oneclickBundles = detectInstalledBundles(profileDir, warnManifest)
      .filter(name => /(?:^|\/)dsh-evolution-preset$/.test(String(name).trim()))
    if (oneclickBundles.length > 0) {
      throw new Error(
        `install-layered: the profile already carries a one-click preset bundle (${oneclickBundles.join(', ')}). `
        + 'The one-click preset bundle and the layered Evolution preset are mutually exclusive install targets (E-33) — '
        + 'the one-click bundle already mounts the model tools at profile root, so the layered preset would double-mount them. '
        + 'Choose ONE: keep the one-click bundle, or uninstall it and install the host bundle + agent preset.',
      )
    }
    // No cross-profile sweep: a preset ROW lives in the target profile's own
    // patch layer (0.2.x), so an evolution-all / one-click row in ANOTHER
    // profile mounts its model rows in that profile only and cannot double-mount
    // with this one.
  }

  if (needsHost || needsCompat) {
    const bundleName = needsHost ? BUNDLES.host : BUNDLES.oneclick
    // D-1 (v18): the one-click preset bundle mounts the four model rows at
    // profile root; a family preset ROW mounts the same rows in preset scope.
    // Refuse unless --force explicitly confirms.
    // The sweep covers EVERY base: a family preset of any variant mounts the
    // same model rows in preset scope, so a one-click install beside it
    // double-mounts exactly as the standard-base preset would. Narrowing this
    // to the base being installed is how a variant becomes an escape hatch.
    // It is a PER-PROFILE question now: the row is written into this profile's
    // patch, and another profile's row cannot double-mount here.
    const targetPatchPath = profilePatchPath(home, profile)
    const targetPatch = existsSync(targetPatchPath) ? await readFile(targetPatchPath, 'utf8') : ''
    const existingPresets = profilePresetRows(targetPatch)
    if (needsCompat && existingPresets.length > 0 && !force) {
      throw new Error(
        `install-layered: profile "${profile}" already carries an Evolution agent preset row (${existingPresets.map(entry => `${entry.base} → ${entry.rowId}`).join(', ')} in ${targetPatchPath}). `
        + 'The one-click preset bundle and the layered agent preset are mutually exclusive install targets (E-33) — '
        + 'both mount the same model rows. Choose ONE '
        + '(remove the preset row or pass --force to override explicitly).',
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
    for (const entry of presetEntries) {
      result.agentPresets.push(await installAgentPreset(home, profile, dryRun, force, basePatches.get(entry.base), entry.base))
    }
    // `agentPreset` stays the FIRST variant's report: it is the field the
    // journal, the CLI summary and the doctor have always read, and a
    // single-base install (the historical call shape) makes it the only one.
    result.agentPreset = result.agentPresets[0] ?? null
  }

  // P1-3 (v19) + v21 (S-1) + v23 (BR-3/BR-4): the FINAL journal refreshes the
  // preset accounting with this run's actual outcome — `true` when the preset
  // was really (re)installed, otherwise the PRIOR journal's accounting is
  // preserved (a skipped preset still exists on disk and its uninstall
  // deliverable must not be lost to a host/oneclick reinstall).
  if (!dryRun && result.bundle !== null) {
    const ownedAny = result.agentPresets.some(entry => entry.installed === true || entry.reason === 'already current')
    await writeInstallJournal(profileDir, journalPayload(ownedAny || priorJournal?.agentPreset === true))
  }
  // v31 INST-03: `--mode agent` installs the profile-level preset row with NO
  // bundle row — the old `result.bundle !== null` gate never journaled it, so
  // a later layered uninstall read `agentPreset:false` and left the preset
  // stranded while reporting a clean removal. Journal the ownership.
  if (!dryRun && result.bundle === null && result.agentPresets.some(entry => entry.installed === true || entry.reason === 'already current')) {
    await writeInstallJournal(profileDir, journalPayload(true))
  }

  return result
}

/** Flag table for `--help` and for the INSTALL.md parity fixture (G2/S2.3).
 * Every flag the parser accepts appears here exactly once, with its value kind. */
export const INSTALL_FLAGS = [
  { flag: '--mode', value: '<layered|profile-root>', summary: 'install target plane (default layered)' },
  { flag: '--profile', value: '<name>', summary: 'profile directory under $DSH_HOME/profiles (default web)' },
  { flag: '--base', value: '<name>[,<name>...]', summary: 'platform agent-preset base the family preset follows (repeatable)' },
  { flag: '--home', value: '<dir>', summary: 'harness home to write into (default $DSH_HOME)' },
  { flag: '--dry-run', value: '', summary: 'report what would change and write nothing' },
  { flag: '--force', value: '', summary: 'proceed past a conflicting install form' },
  { flag: '--check-presets', value: '', summary: 'report on the presets already on disk (composes with any mode)' },
  { flag: '--uninstall', value: '', summary: 'remove the generated preset and its rows' },
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
  const options = { mode: 'layered', profile: 'web', bases: [] }
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
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    // `--check-presets` is a FLAG, not a mode: it reports on the presets already
    // on disk and writes nothing, so it composes with any (or no) --mode.
    else if (arg === '--check-presets') options.checkPresets = true
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
    } else if (options.checkPresets) {
      const report = await checkAgentPresetFreshness(options)
      for (const entry of report.bases) {
        console.log(`preset:   ${entry.id}  ${entry.patchPath}  ${entry.status === 'differs' ? 'DIFFERS' : entry.status}`)
      }
      console.log('check:    DIFFERS means the row in the profile patch is an install-time snapshot of a platform that has moved; re-run the installer to regenerate it (this check only reports, it never overwrites).')
      // Any difference is a nonzero exit so a script can gate on staleness; a
      // merely absent preset is not a difference (the user may not want it).
      if (report.bases.some(entry => entry.status === 'differs')) process.exitCode = 1
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
      console.log(`form:     ${result.form}${result.form === 'variant' ? ' (session opt-in: original presets carry no family rows)' : result.form === 'attach' ? ' (profile-level: every session carries the family rows)' : ''}`)
      console.log(`profile:  ${result.profile} (${result.profileDir})`)
      if (result.bundle) console.log(`bundle:   ${result.bundle}`)
      console.log(`copied:   ${result.copied.length} evolution packages`)
      if (result.missingEntrypoints.length > 0) {
        console.log(`unbuilt:  ${result.missingEntrypoints.length} packages lack lib/index.js — build them first, or boot the profile with a TS loader`)
      }
      for (const preset of result.agentPresets ?? []) {
        console.log(`preset:   ${preset.rowId} → ${preset.patchPath}${preset.installed ? '' : ` (${preset.reason})`}`)
      }
      if (options.dryRun) console.log('dry-run:  no files were written')
    }
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
