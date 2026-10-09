/**
 * The family's package-discovery rules, in ONE place (v43 audit S1-2).
 *
 * Two rules used to live apart: the source installer discovered packages by a
 * hardcoded prefix allowlist while the release script discovered them by
 * 'directory with a package.json'. A new package whose name missed the
 * allowlist was therefore PUBLISHED but never installable, with no diagnostic
 * anywhere — the difference set is what this module exists to make visible
 * (see verify-package-discovery.mjs).
 *
 * @module lib-family-packages
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Scoped-name prefixes the source installer accepts (install-layered.mjs).
 * Kept byte-identical to the historical constant; the point of the move is
 * that the gate reads the SAME array instead of restating it. */
export const EVOLUTION_PREFIXES = [
  'dsh-evolution-',
  'dsh-memory',
  'dsh-memory-files',
  'dsh-skill-usage',
  'dsh-tool-memory',
  'dsh-tool-skill-manage',
]

/** The evolution INSTALL-TARGET bundle tails (all / host / preset), in ONE
 * place (P2-20, audit): the installer's exclusion sweeps, the profile
 * verifier and doctor's install-form classification all key on this exact
 * set — a fourth target added in one copy but not the others silently
 * desynced doctor from the installer. Consumers: install-layered.mjs,
 * verify-profile-bundles.mjs (scripts side); evolution-commands/src/doctor.ts
 * keeps the TS-side Set, pinned to this list by guard-scripts.spec.ts. */
export const EVOLUTION_BUNDLE_TAILS = [
  'dsh-evolution-all',
  'dsh-evolution-host',
  'dsh-evolution-preset',
]

/** Directories under packages/ that are not publishable packages, by NAME.
 * v46 S1.10 (finding T7-16): the set used to name `.release-staging` — a directory the tree has
 * not carried for releases — while the real flip leftovers are `.release-staging.next` /
 * `.release-staging.previous`. It never mattered only because publishableDirs() ALSO required a
 * package.json, so a leftover carrying one (a staging copy does) would have been published by the
 * second rule while the first said it was excluded. */
export const NON_PACKAGE_DIRS = new Set([
  'scripts', 'docs', 'node_modules', 'dist.next',
  '.release-staging', '.release-staging.next', '.release-staging.previous',
])

/**
 * Is this directory excluded from publication by its NAME alone?
 * A dot-directory is never a package (staging flips, editor and cache dirs land there).
 * @param name - the directory name under packages/.
 * @returns whether publication skips it.
 */
export function isNonPackageDir(name) {
  return name.startsWith('.') || NON_PACKAGE_DIRS.has(name)
}

/**
 * Every publishable package directory: a directory holding a package.json.
 * This is the release script's own rule (prepare-release.mjs's sourceDirs).
 * @param packagesRoot - absolute path of the `packages/` directory.
 * @returns directory names, sorted.
 */
export function publishableDirs(packagesRoot) {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !isNonPackageDir(entry.name))
    .map(entry => entry.name)
    // The manifest check is the SECOND line, not the only one: the name rule above is what keeps
    // a staging leftover from being published, and this line keeps a directory that merely lacks
    // a manifest out of the list.
    .filter(name => existsSync(join(packagesRoot, name, 'package.json')))
    .sort()
}

/**
 * The installer's acceptance rule, as implemented at install-layered.mjs:479.
 * @param packageName - the manifest `name` (already rescoped by the caller).
 * @returns whether the installer would consider this package part of the family.
 */
export function installerAccepts(packageName) {
  return EVOLUTION_PREFIXES.some(prefix => packageName.startsWith(prefix))
}

/**
 * Read one package's manifest name, or null when it cannot be read.
 * @param packagesRoot - absolute path of the `packages/` directory.
 * @param dir - the package directory name.
 * @returns the manifest name, or null.
 */
export function manifestName(packagesRoot, dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(packagesRoot, dir, 'package.json'), 'utf8'))
    return typeof parsed.name === 'string' ? parsed.name : null
  } catch {
    return null
  }
}
