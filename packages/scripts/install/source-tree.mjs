/**
 * SourceTree: the ONE resolver for where an installer run reads bytes from.
 *
 * Three kinds share one contract — source checkout, `.release-staging`, and a prepare-release dist
 * (packed tarballs). Each must answer the same four questions before a single write: which root,
 * which family version, which scope, and (for dist) that the evidence describes the packed bytes.
 * The installer used to answer them in three different branches; W11 C2 moves them here.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { familyVersion as familyVersionOf } from '../lib-family-version.mjs'

/** The family packages root (`packages/` in the mirror, `packages/evolution/` in the overlay). */
export const PACKAGES_DIR = fileURLToPath(new URL('../../', import.meta.url))

/** `--from-dist` is parsed once, before any composer import. */
export const FROM_DIST_ARG = (() => {
  const index = process.argv.indexOf('--from-dist')
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error('install-layered: --from-dist needs the dist directory prepare-release wrote')
  }
  return value
})()

/** A packed install only exists under the release scope; default to it when --from-dist is used. */
export const EVOLUTION_SCOPE = process.env.EVOLUTION_SCOPE?.trim() || (FROM_DIST_ARG !== undefined ? '@lmzhen' : '@deepseek-ai')

export const STAGING_DIR = join(PACKAGES_DIR, '.release-staging')

/** Extract every packed tarball into <tmp>/<bareName>/ and return that source root. */
export function prepareDistSourceRoot(distDir) {
  const resolved = resolve(distDir)
  const manifestPath = join(resolved, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error('install-layered: --from-dist ' + resolved + ' has no manifest.json (pass the prepare-release dist directory)')
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // Audit 06 P0-3: the packed path must judge the same two facts as source/staging: one scope for
  // every tarball name, and (when the dist carries evidence) that the evidence describes the bytes.
  const distScope = process.env.EVOLUTION_SCOPE?.trim() || '@lmzhen'
  const scopes = new Set(Object.keys(manifest).map((name) => name.split('/')[0]))
  if (scopes.size !== 1 || !scopes.has(distScope)) {
    throw new Error('install-layered: --from-dist manifest names ' + JSON.stringify([...scopes]) + ' but this install resolves under "' + distScope + '" — rebuild the dist with the same scope')
  }
  const evidencePath = join(resolved, 'release-evidence.json')
  // Extract INSIDE the family tree so the packed composer's own imports resolve through the
  // checkout's node_modules — a system-temp extraction has no dependency tree.
  const familyRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const root = mkdtempSync(join(familyRoot, '.from-dist-'))
  process.on('exit', () => { try { rmSync(root, { recursive: true, force: true }) } catch { /* Windows may still hold a file; the dot dir is ignored */ } })
  // The extraction uses ONLY relative paths: cwd = the dist directory (archive argument is a bare
  // file name) and -C is the relative path to the destination. An absolute `D:\...` argument makes
  // GNU tar read the drive letter as a REMOTE host (Git-for-Windows tar), and the MSYS path forms
  // are not stable across runners; relative paths sidestep both.
  const distRelative = (target) => relative(resolved, target).split(sep).join('/')
  for (const [name, file] of Object.entries(manifest)) {
    const bare = name.startsWith('@') ? (name.split('/')[1] ?? '') : name
    const destination = join(root, bare)
    mkdirSync(destination, { recursive: true })
    try {
      execFileSync('tar', ['-xzf', String(file), '-C', distRelative(destination), '--strip-components=1'], { stdio: 'pipe', cwd: resolved })
    } catch (error) {
      const detail = error !== null && typeof error === 'object' && error.stderr !== undefined && error.stderr !== null ? String(error.stderr) : (error instanceof Error ? error.message : String(error))
      throw new Error('install-layered: cannot unpack ' + file + ' from --from-dist (' + detail.trim().slice(0, 240) + ')')
    }
  }
  // The evidence describes the PACKED tree (a dev build packs RELEASE_VERSION=0.0.0-main while the
  // source checkout stays 0.46.0), so it is compared with the extracted tile — not with the source
  // tree. A mismatch means the dist directory mixes a pack and an evidence file from other bytes.
  if (existsSync(evidencePath)) {
    let evidence
    try { evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) } catch (error) {
      throw new Error('install-layered: --from-dist release-evidence.json is unreadable (' + (error instanceof Error ? error.message : String(error)) + ')')
    }
    const packedVersion = familyVersionOf(root, root)
    if (typeof evidence.familyVersion !== 'string' || evidence.familyVersion !== packedVersion) {
      throw new Error('install-layered: --from-dist evidence familyVersion ' + String(evidence.familyVersion) + ' does not match the packed tree ' + String(packedVersion) + ' — the dist mixes bytes from different builds')
    }
  }
  return root
}

export const DIST_SOURCE_ROOT = FROM_DIST_ARG === undefined ? null : prepareDistSourceRoot(FROM_DIST_ARG)

/** The family version of one tree (source, staging, or a packed extraction). */
export function familyVersion(sourceRoot = packageSourceRoot()) {
  return familyVersionOf(sourceRoot, sourceRoot)
}

/** One staging/dist identity check: the version must be the family's, the scope this install's. */
export function validateTreeIdentity(tree, expectedVersion, expectedScope, label = 'the tree') {
  if (typeof tree.version !== 'string' || tree.version === '' || tree.version !== expectedVersion) {
    throw new Error('scoped installer: ' + label + ' was built for ' + String(tree.version || '(unknown)') + ' but this tree is ' + String(expectedVersion || '(unknown)') + ' — the staging is stale; run prepare-release.mjs --scope ' + expectedScope + ' to rebuild it')
  }
  if (typeof tree.scope !== 'string' || tree.scope === '') {
    throw new Error('scoped installer: ' + label + ' has no "scope" field — this staging predates scope recording and cannot be scope-verified; run prepare-release.mjs --scope ' + expectedScope + ' to rebuild it')
  }
  if (tree.scope !== expectedScope) {
    throw new Error('scoped installer: ' + label + ' was built under scope "' + tree.scope + '" but EVOLUTION_SCOPE is "' + expectedScope + '" — the staged package names do not match this install\'s scope. Re-run prepare-release.mjs --scope ' + expectedScope + ' to rebuild the staging, or set EVOLUTION_SCOPE=' + tree.scope + ' to install the existing one')
  }
}

/** Where this run copies packages FROM; every branch validates its tree before returning it. */
export function packageSourceRoot() {
  if (DIST_SOURCE_ROOT !== null) return DIST_SOURCE_ROOT
  if (EVOLUTION_SCOPE === '@deepseek-ai') return PACKAGES_DIR
  if (existsSync(STAGING_DIR)) {
    const manifestPath = join(STAGING_DIR, '.staging-manifest.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`scoped installer: ${STAGING_DIR} is not a fresh prepare-release staging — missing .staging-manifest.json; run prepare-release.mjs --scope ${EVOLUTION_SCOPE} to rebuild it`)
    }
    const stagingManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const expected = familyVersion(PACKAGES_DIR)
    validateTreeIdentity({ version: stagingManifest.version, scope: stagingManifest.scope }, expected, EVOLUTION_SCOPE, STAGING_DIR)
    return STAGING_DIR
  }
  throw new Error(`scoped installer requires ${STAGING_DIR}; run prepare-release.mjs --scope ${EVOLUTION_SCOPE} first`)
}
