#!/usr/bin/env node
/**
 * smoke-built-entries — load the BUILT family against the INSTALLED platform.
 *
 * What this covers that nothing else does: tsc checks types against the platform's
 * declarations, vitest checks the logic against test doubles, and neither ever
 * imports the shipped `lib/` ESM with the platform packages a host resolves at
 * runtime. A platform member that moved, a subpath that stopped resolving, or a
 * module that throws while evaluating is a failure here instead of a broken boot.
 *
 * The entries are STAGED: every family package is copied (`lib/` + manifest) into a
 * temporary `node_modules`, the installed platform scope is symlinked in, and the
 * entries are imported from there — the layout a profile gets from `dsh plugin add`.
 *
 * The surface under test is DERIVED from the composition files (bundle roster + the
 * preset YAMLs), never hand-listed: each specifier a composition mounts — including
 * a subpath entry such as `…/evolution-maintenance/tools` — is resolved through the
 * package's own `exports` map and imported. A mounted entry must expose a loader
 * shape (a default-exported class, or a named `apply` with `name` / `inject` /
 * `Config` where present); every other package only has to import cleanly, and an
 * entry may be empty only for a bundle / client / YAML-only package.
 *
 * Usage (run in the OVERLAY; the flat mirror has no platform install):
 *   node <scripts-dir>/smoke-built-entries.mjs <evolution-root> [--platform <scope-dir>]
 *     --platform  the `@deepseek-ai` scope directory to resolve platform packages from
 *                 (default: ~/.dsh/profiles/node_modules/@deepseek-ai)
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const NL = String.fromCharCode(10)
const argv = process.argv.slice(2)
const root = resolve(argv.find((arg) => !arg.startsWith('--')) ?? 'packages/evolution')
const platformArg = argv.indexOf('--platform')
const platform = resolve(platformArg >= 0 ? (argv[platformArg + 1] ?? '') : join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai'))
const problems = []

/** Family package-name prefixes (the specs the compositions may mount). */
const FAMILY_PREFIXES = ['@deepseek-ai/dsh-evolution-', '@deepseek-ai/dsh-memory', '@deepseek-ai/dsh-skill-usage', '@deepseek-ai/dsh-tool-']

/**
 * Whether a package may legally ship an empty entry.
 * @param manifest - the package manifest.
 * @returns true for a bundle, client, or YAML-only package.
 */
function mayBeEmpty(manifest) {
  if (manifest.dsh !== undefined && (manifest.dsh.bundle !== undefined || manifest.dsh.client !== undefined)) return true
  return Object.keys(manifest.exports ?? {}).some((key) => key.endsWith('.yml'))
}

/**
 * Assert the loader-facing surface of one imported entry.
 * @param rel - the entry path, for the message.
 * @param mod - the imported module namespace.
 * @param manifest - the owning package's manifest.
 * @param mounted - whether a composition mounts this exact entry.
 * @returns the problem text, or null when the entry is loadable.
 */
function shapeProblem(rel, mod, manifest, mounted) {
  if (Object.keys(mod).length === 0) {
    if (mayBeEmpty(manifest)) return null
    return rel + ': the entry exports nothing' + (mounted ? ', but a composition mounts it' : '')
  }
  const apply = mod.apply
  const hasDefault = typeof mod.default === 'function'
  if (apply !== undefined && typeof apply !== 'function') return rel + ': `apply` is exported but is not a function'
  if (typeof apply !== 'function' && !hasDefault) {
    return mounted ? rel + ': a composition mounts this entry, but it exports neither named `apply` nor a default-exported class' : null
  }
  if (mod.name !== undefined && (typeof mod.name !== 'string' || mod.name.length === 0)) return rel + ': `name` is exported but is not a non-empty string'
  if (mod.inject !== undefined && !Array.isArray(mod.inject)) return rel + ': `inject` is exported but is not an array'
  if (Array.isArray(mod.inject) && mod.inject.some((entry) => typeof entry !== 'string')) return rel + ': `inject` carries a non-string service name'
  if (mod.Config !== undefined && typeof mod.Config !== 'function' && typeof mod.Config !== 'object') return rel + ': `Config` is exported but is neither a schema function nor a schema object'
  return null
}

const packages = []
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const dir = join(root, entry.name)
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) continue
  packages.push({ dir, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) })
}
const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]))

// Mounted specifiers, derived from the composition files the loader itself reads.
const mounted = new Set()
const scan = (text) => { for (const match of text.matchAll(/@deepseek-ai\/dsh-[a-z0-9-]+(?:\/[a-z0-9-]+)?/g)) mounted.add(match[0]) }
const rosterPath = join(root, 'scripts', 'bundle-rows.json')
if (existsSync(rosterPath)) scan(readFileSync(rosterPath, 'utf8'))
for (const pkg of packages) {
  for (const [key, value] of Object.entries(pkg.manifest.exports ?? {})) {
    if (!key.endsWith('.yml')) continue
    const file = join(pkg.dir, typeof value === 'string' ? value : (value.default ?? ''))
    if (existsSync(file)) scan(readFileSync(file, 'utf8'))
  }
}

/**
 * Resolve a mounted specifier to the built file and its package.
 * @param specifier - `@scope/name` or `@scope/name/subpath`.
 * @returns the package and its entry's path inside the package, or null.
 */
function targetOf(specifier) {
  const parts = specifier.split('/')
  const name = parts.slice(0, 2).join('/')
  const pkg = byName.get(name)
  if (pkg === undefined) return null
  const subpath = parts.slice(2).join('/')
  if (subpath === '') return { pkg, file: join(pkg.dir, pkg.manifest.main ?? 'lib/index.js') }
  const exported = (pkg.manifest.exports ?? {})['./' + subpath]
  const rel = typeof exported === 'string' ? exported : (exported !== undefined && exported.default !== undefined ? exported.default : './lib/' + subpath + '.js')
  return { pkg, file: join(pkg.dir, rel) }
}

// A mounted specifier is either a package of this tree (staged and shape-checked)
// or one the platform ships (it must at least exist in the platform scope).
const treeMounted = []
const notes = []
for (const specifier of mounted) {
  if (targetOf(specifier) !== null) { treeMounted.push(specifier); continue }
  // Platform-provided rows are named by the family but shipped by the platform, and
  // the installed scope may be a different platform generation (the 0.1.x line names
  // some of these rows differently), so this is a note, never a failure.
  const name = specifier.split('/').slice(0, 2).join('/')
  const dir = join(platform, name.slice(name.indexOf('/') + 1))
  notes.push(specifier + (existsSync(dir) ? ' — provided by the platform scope' : ' — not in the platform scope at ' + platform))
}

const stage = mkdtempSync(join(tmpdir(), 'evo-smoke-'))
const scope = join(stage, 'node_modules', '@deepseek-ai')
mkdirSync(join(stage, 'node_modules'), { recursive: true })
if (!existsSync(platform)) {
  console.error('smoke-built-entries: no platform scope at ' + platform + ' — pass --platform')
  process.exit(2)
}
symlinkSync(platform, scope, 'junction')

/** Map a package-relative path onto the staged copy. */
const staged = (file, dir) => join(scope, dir.manifest.name.slice(dir.manifest.name.indexOf('/') + 1), file.slice(dir.dir.length + 1))

const loaded = new Set()
try {
  for (const pkg of packages) {
    const target = join(scope, pkg.manifest.name.slice(pkg.manifest.name.indexOf('/') + 1))
    if (!existsSync(join(pkg.dir, 'lib'))) { problems.push(pkg.manifest.name + ': no lib/ next to the manifest (run build-lib.mjs)'); continue }
    mkdirSync(target, { recursive: true })
    cpSync(join(pkg.dir, 'lib'), join(target, 'lib'), { recursive: true })
    cpSync(join(pkg.dir, 'package.json'), join(target, 'package.json'))
  }
  // 1) the entries a composition mounts — the deployment surface.
  for (const specifier of treeMounted) {
    const target = targetOf(specifier)
    if (target === null) continue
    const file = staged(target.file, target.pkg)
    const rel = specifier
    if (!existsSync(file)) { problems.push(rel + ': the mounted entry is not in the built package (exports points at ' + target.file.slice(target.pkg.dir.length + 1) + ')'); continue }
    const mod = await import(pathToFileURL(file).href).catch((error) => ({ __error: error }))
    if (mod.__error !== undefined) {
      problems.push(rel + ': import failed — ' + (mod.__error instanceof Error ? mod.__error.message.split(NL)[0] : String(mod.__error)))
      continue
    }
    loaded.add(specifier)
    const problem = shapeProblem(rel, mod, target.pkg.manifest, true)
    if (problem !== null) problems.push(problem)
  }
  // 2) every package root — a library that throws while evaluating is a failure too.
  for (const pkg of packages) {
    const rootEntry = join(scope, pkg.manifest.name.slice(pkg.manifest.name.indexOf('/') + 1), 'lib', 'index.js')
    if (!existsSync(rootEntry)) continue
    const mod = await import(pathToFileURL(rootEntry).href).catch((error) => ({ __error: error }))
    if (mod.__error !== undefined) {
      problems.push(pkg.manifest.name + '/lib/index.js: import failed — ' + (mod.__error instanceof Error ? mod.__error.message.split(NL)[0] : String(mod.__error)))
    }
  }
} finally {
  rmSync(stage, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error('smoke-built-entries: ' + problems.length + ' problem(s) over ' + packages.length + ' package(s)')
  console.error(problems.join(NL))
  process.exit(1)
}
console.log('smoke-built-entries: OK — ' + treeMounted.length + ' mounted entry(ies) and ' + packages.length + ' package root(s) imported against ' + platform)
if (notes.length > 0) console.log('smoke-built-entries: ' + notes.length + ' platform-provided row(s) not declared here:\n  ' + notes.join('\n  '))
