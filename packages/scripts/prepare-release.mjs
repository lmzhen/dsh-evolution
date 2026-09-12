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
 *   node packages/scripts/build-lib.mjs
 *   node packages/scripts/prepare-release.mjs \
 *     --scope @lmzhen --version 0.1.0-rc.NN --platform-version 0.1.1-rc.NN
 *
 * `--dev-build` marks a NON-RELEASE pack: a main-branch CI push packs with the
 * dev placeholder `RELEASE_VERSION` (see release.yml) so the pack step and the
 * publish dry-run still run there, and this flag says so explicitly — version
 * reconciliation is skipped, the staging is unpublishable, and the release path
 * (tags) never passes it.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evolutionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(evolutionRoot, '../..')
const distRoot = join(evolutionRoot, 'dist')
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const index = argv.indexOf(name)
  // v31 INST-05: a following FLAG is not this flag's value (`--scope
  // --version` used to bind '--version' as the scope and fail later, far
  // from the cause).
  const value = index >= 0 ? argv[index + 1] : undefined
  if (value === undefined || value.startsWith('--')) return fallback
  return value
}

function requireArg(name) {
  const value = arg(name)
  if (!value) throw new Error(`prepare-release: missing required ${name}; the release workflow pins it (single source)`)
  return value
}

const scope = requireArg('--scope')
const releaseVersion = requireArg('--version')
const platformVersion = requireArg('--platform-version')
// Explicit non-release pack (main-branch CI): never inferred from the version
// string, so a real release that passes a wrong --version still fails below.
const devBuild = argv.includes('--dev-build')

// v21 (S-4): reconcile the release version with the PACKAGE MANIFESTS before
// anything is staged. The install side (install-layered familyVersion)
// re-derives the family version from evolution-host/package.json, so a
// --version that drifted from the manifests publishes cleanly and then bricks
// every scoped install with "staging was built for X but this tree is Y" —
// a mismatch must fail HERE, naming both sides.
{
  const manifestVersion = JSON.parse(readFileSync(join(evolutionRoot, 'evolution-host', 'package.json'), 'utf8')).version
  if (manifestVersion !== releaseVersion) {
    if (devBuild) {
      console.log(
        `prepare-release: dev build — version reconciliation skipped (manifests ${manifestVersion}, staging ${releaseVersion}); `
        + 'this staging is a CI diagnostic and is not publishable',
      )
    } else {
      throw new Error(
        `prepare-release: --version ${releaseVersion} != package manifests ${manifestVersion} — `
        + 'bump the manifests/CHANGELOG (normalize-mirror) or pass the matching --version',
      )
    }
  }
}

// R-06: the two vendored framework ranges the release metadata pins. Sync
// source: the upstream checkout's vendor/ tags these ranges target
// (vendor/cordis, vendor/schemastery) — update HERE and the upstream vendor
// tag in the same change, or the published ranges drift from the validated
// compat anchor. (zod is likewise double-pinned in tsconfig.base.json + the
// dependency manifests; a cross-checking guard for it is deliberately
// deferred — optimization plan §5, R-06b.)
const VENDORED_CORDIS_RANGE = '^4.0.1'
const VENDORED_SCHEMASTRY_RANGE = '^3.18.1'

// R-05: the workspace protocols the rewrite understands. A literal
// `workspace:` spec that does not match must fail loud — silently shipping the
// literal into a published manifest is exactly the defect class this rewrite
// exists to prevent.
const WORKSPACE_SPEC_RE = /^workspace:(\^|~|\*)$/

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

function releaseSpec(name, ourNames, protocol = '^') {
  if (ourNames.has(name)) return `${protocol === '~' ? '~' : '^'}${releaseVersion}`
  if (name === '@deepseek-ai/cordis') return VENDORED_CORDIS_RANGE
  if (name === '@deepseek-ai/schemastery') return VENDORED_SCHEMASTRY_RANGE
  // Platform packages range against the published upstream version, NOT the
  // development baseline — CI guards manifest parity with the compat anchor
  // (verify-platform-ranges.mjs, N-2).
  if (name.startsWith('@deepseek-ai/dsh-')) {
    return `^${platformVersion}`
  }
  // D-7 (v18): the `npm view` registry lookup that used to sit here was dead
  // for the current dependency set — all 16 external workspace deps hit a
  // branch above — while costing 16 network calls per pack (and a fail-loud
  // escape hatch that could never fire). A NEW external must not silently ship
  // our release version as its range: name it here and pin its range.
  throw new Error(`prepare-release: no range rule for external dependency ${name} — add a branch to releaseSpec with the version range to publish`)
}

function rewritePackage(pkg, ourNames, sourceDir) {
  pkg.version = releaseVersion
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      let rewritten = name
      if (scope && ourNames.has(name)) rewritten = scopedPackageName(name)
      if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        // R-05: accept every common workspace protocol (^, ~, *) —
        // `workspace:*` / `workspace:~` used to sail through and ship their
        // literal into the tarball. A protocol outside the whitelist fails
        // loud instead. `*` publishes as ^<version>: `*` itself would resolve
        // to anything, and verify-platform-ranges (N-2) demands a ^-range for
        // platform deps.
        const match = WORKSPACE_SPEC_RE.exec(spec)
        if (!match) throw new Error(`prepare-release: ${name} uses unsupported protocol "${spec}" — only workspace:^ / workspace:~ / workspace:* are rewritten; refusing to ship the literal`)
        pkg[section][name] = releaseSpec(name, ourNames, match[1])
      }
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
      // P2-14 (V10-17): derive from the PACKAGED directory name (the flat
      // public mirror layout, e.g. packages/evolution-core) — the previous
      // name-derived path (packages/dsh-evolution-core after the scope
      // rewrite) never existed, so every npm source link was dead.
      directory: `packages/${sourceDir}`,
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

/**
 * Swap `next` into `target`, keeping the prior `target` recoverable until the
 * new content is in place (0.3.28): the old rm-target-then-rename was two
 * steps, so a failure between them destroyed the previous good staging/dist
 * with no recovery. Moving the target aside first means an interrupted swap
 * leaves the previous good build at `<target>.previous`. Re-runnable: a stale
 * `.previous` from an earlier interrupted swap is removed first.
 */
function atomicSwap(next, target) {
  const previous = `${target}.previous`
  // V5-13 (0.3.31): a rerun after an interrupted swap may find the target
  // ABSENT with the previous good build still at `.previous` — the old code
  // removed it first and destroyed the only recovery copy. Restore it before
  // anything else (idempotent: a healthy run has no `.previous`).
  if (!existsSync(target) && existsSync(previous)) renameSync(previous, target)
  rmSync(previous, { recursive: true, force: true })
  if (existsSync(target)) renameSync(target, previous)
  try {
    renameSync(next, target)
  } catch (error) {
    if (existsSync(previous)) renameSync(previous, target)
    throw error
  }
  rmSync(previous, { recursive: true, force: true })
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

const tarballs = []
for (const dir of sourceDirs) {
  const original = join(evolutionRoot, dir)
  const staged = join(stagingNext, dir)
  // The staging copy keeps `lib/` (only node_modules/tests are excluded): the
  // published tarball must ship the built runtime, so filtering `lib/` here
  // would break the package. The freshness contract belongs to the caller —
  // CI runs build-lib.mjs (tsc + tsdown) before prepare-release, so `lib/` is
  // fresh there; a LOCAL prepare-release without a prior build copies whatever
  // `lib/` is already on disk, so run build-lib.mjs first or accept a stale
  // bundle.
  cpSync(original, staged, {
    recursive: true,
    force: true,
    filter(path) {
      const base = path.slice(original.length + 1)
      return base !== 'node_modules' && !base.startsWith('tests')
    },
  })
  const manifestPath = join(staged, 'package.json')
  const manifest = rewritePackage(readJson(manifestPath), new Set(names.keys()), dir)
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
  // R-05: fail fast BEFORE packing when the staged package carries no
  // built bundle — a missing lib/ used to surface as a raw readdirSync ENOENT
  // in the validation loop, after every package had already packed. (The
  // validation loop below unconditionally walks lib/, so lib/ is a hard
  // prerequisite for every family package.)
  // v31 GUARD-02: freshness warning — build-lib never cleans orphaned lib/
  // outputs and `tsc -b` does not remove deleted modules' declarations, so a
  // rename/delete followed by pack-without-rebuild used to ship stale files
  // under lib/types. Warn (not fail): a rebuild is the operator's call.
  {
    let newestSrc = 0
    const walkSrc = (dirPath) => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const full = join(dirPath, entry.name)
        if (entry.isDirectory()) walkSrc(full)
        else newestSrc = Math.max(newestSrc, statSync(full).mtimeMs)
      }
    }
    try { walkSrc(join(staged, 'src')) } catch { /* no src — skip the check */ }
    let oldestLib = Number.POSITIVE_INFINITY
    const walkLib = (dirPath) => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const full = join(dirPath, entry.name)
        if (entry.isDirectory()) walkLib(full)
        else oldestLib = Math.min(oldestLib, statSync(full).mtimeMs)
      }
    }
    try { walkLib(join(staged, 'lib')) } catch { /* lib absence handled above */ }
    if (newestSrc > oldestLib) {
      console.warn(`prepare-release: warning — ${dir}: src/ has file(s) newer than every lib/ output; if sources were renamed or deleted, stale lib/ files may be packed. Re-run build-lib.mjs to be safe.`)
    }
  }
  if (!existsSync(join(staged, 'lib'))) {
    console.error(`prepare-release: ${dir} has no lib/ build output — run build-lib.mjs first, then prepare-release`)
    process.exit(1)
  }
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
    // P2-38 (v11): the local-import guard only recognizes DOUBLE-QUOTED
    // static `from "./x.js"` (what tsdown emits today). Single-quote imports,
    // dynamic `import("./x.js")` and re-exports are outside its scope — if the
    // bundler style changes, extend this pattern or the guard silently turns
    // vacuum-pass.
    for (const match of text.matchAll(/from\s+"(\.\/[^"]+\.js)"/g)) {
      const local = join(libRoot, match[1].slice(2))
      if (!inShipped(relative(staged, local).replace(/\\/g, '/'))) {
        failures.push(`${item.name}: lib/${rel} imports ${match[1]} which is missing from the tarball`)
      }
    }
  }
  for (const [name, target] of Object.entries(manifest.exports ?? {})) {
    // V8-20 (0.3.48): the guard covered ONLY string-form exports (35 of 96) —
    // the object form ({ types, default }: 61 entries incl. every main entry
    // and ./invariant) was never checked. Recurse one level over the object
    // values (types/default) with the same inShipped test.
    if (typeof target === 'string' && !inShipped(target)) {
      failures.push(`${item.name}: export ${name} -> ${target} is missing from the tarball`)
    } else if (typeof target === 'object' && target !== null) {
      for (const [sub, value] of Object.entries(target)) {
        if (typeof value === 'string' && !inShipped(value)) {
          failures.push(`${item.name}: export ${name}.${sub} -> ${value} is missing from the tarball`)
        }
      }
    }
  }
  // D-8 (v18): the manifest can DECLARE a bundle/preset file the tarball does
  // not ship — a `files` whitelist regression then publishes a package
  // `dsh plugin add` cannot mount while every check above stays green.
  const bundlePatch = manifest.dsh?.bundle?.patch
  if (typeof bundlePatch === 'string' && !inShipped(bundlePatch)) {
    failures.push(`${item.name}: manifest dsh.bundle.patch -> ${bundlePatch} is missing from the tarball`)
  }
  // The preset container is mountable only with BOTH compositions; the
  // exports map is the declaration that says "this package is that container".
  if (manifest.exports?.['./agent.cordis.yml'] !== undefined || manifest.exports?.['./preset.yml'] !== undefined) {
    for (const rel of ['agent.cordis.yml', 'preset.yml']) {
      if (!inShipped(rel)) failures.push(`${item.name}: preset container is missing ${rel}`)
    }
  }
  // V24-18 (v24): every SHIPPED .yml gets the same unrewritten-scope scan the
  // lib/ bundles get. The rewrite step above covers a hardcoded four-file
  // whitelist (cordis.yml / cordis.patch.yml / agent.cordis.yml / preset.yml);
  // a future fifth composition file added to files/exports would publish with
  // raw `@deepseek-ai/dsh-*` row names — `dsh plugin add` then fails to
  // resolve the mount while every other guard stays green. Scanning the
  // shipped list (not staging disk) matches the F-356 posture.
  for (const rel of item.shipped) {
    if (!rel.endsWith('.yml') && !rel.endsWith('.yaml')) continue
    const text = readFileSync(join(staged, ...rel.split('/')), 'utf8')
    for (const originalName of names.keys()) {
      if (text.includes(originalName)) {
        failures.push(`${item.name}: ${rel} still references ${originalName} (unrewritten scope in a shipped composition file)`)
      }
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
  ['evolution-activity', 'evolution-feedback', 'evolution-learning-graph', 'evolution-replay', 'evolution-skill-catalog'],
  ['evolution-host', 'evolution-preset', 'evolution-agent', 'evolution-all'],
]
// P2-39 (v11): the hardcoded table MUST equal the staged tarballs — a stale
// entry previously wrote `null` into publish-order.json (and the downstream
// consistency check blamed the wrong root cause). Fail loud naming both sides.
const stagedDirs = tarballs.map(item => item.dir)
const publishGroupDirs = publishGroups.flat()
const stagedButUnlisted = stagedDirs.filter(dir => !publishGroupDirs.includes(dir))
const listedButUnstaged = publishGroupDirs.filter(dir => !stagedDirs.includes(dir))
if (stagedButUnlisted.length > 0 || listedButUnstaged.length > 0) {
  throw new Error(
    `prepare-release: publish-order tables out of sync — staged-but-unlisted: ${stagedButUnlisted.join(', ') || '(none)'}; `
    + `listed-but-unstaged: ${listedButUnstaged.join(', ') || '(none)'}. Update the publishGroups table in prepare-release.mjs.`,
  )
}
writeFileSync(join(distNext, 'publish-order.json'), JSON.stringify(publishGroups.map(group => group.map(dir => nameByDir[dir])), null, 2) + '\n')

// P3 (v15): the `smoke-package.json` artifact was removed — nothing in the
// repo (workflows, scripts, docs) ever read it; it was residue of a
// historical manual smoke-install flow. `publish-order.json` above stays:
// the publish step consumes it.

// Atomic swap: only now that the whole build (and its guard) passed do the
// live `.release-staging` and `dist` replace their `.next` siblings. A failed
// build never disturbs a previously good dist or a previously fresh staging.
// Each swap keeps the prior target recoverable until the new content is in
// place, so an interrupted swap can be re-run (see atomicSwap).
atomicSwap(stagingNext, staging)
atomicSwap(distNext, distRoot)

console.log(`packed ${tarballs.length} packages -> ${distRoot}`)

