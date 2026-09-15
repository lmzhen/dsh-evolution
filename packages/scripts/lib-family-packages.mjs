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

/** Directories under packages/ that are not publishable packages. */
export const NON_PACKAGE_DIRS = new Set(['scripts', 'docs', 'node_modules', '.release-staging', 'dist.next'])

/**
 * Every publishable package directory: a directory holding a package.json.
 * This is the release script's own rule (prepare-release.mjs's sourceDirs).
 * @param packagesRoot - absolute path of the `packages/` directory.
 * @returns directory names, sorted.
 */
export function publishableDirs(packagesRoot) {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !NON_PACKAGE_DIRS.has(entry.name))
    .map(entry => entry.name)
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
