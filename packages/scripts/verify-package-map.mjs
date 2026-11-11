#!/usr/bin/env node
/**
 * G4.1/G4.3: the package map must name exactly the packages the tree publishes — and the tree must
 * carry nothing else.
 *
 * The map in packages/README.md is prose (one line per area), so it cannot be generated — but its SET
 * membership can be checked, and that is what drifts: a new package lands and nobody adds a row, or a
 * row outlives the package it names. Both directions fail here.
 *
 * W7.2 (2026-11-11) — the TREE half. Until this change the guard read map <-> published manifests only
 * and never asked what ELSE the tree carried. A local test-wiring script
 * (`D:/dsh/_tools/setup-mirror-tests.mjs`) creates Windows junctions for 22 platform package groups —
 * at the repo root and under packages/ — so single-package tsconfigs resolve; those junctions then sat
 * in the worktree and a release commit's bare `git add -A` committed 6510 files THROUGH them into
 * v0.43.2-rc.1. Nothing here objected (the groups carry no package.json of their own: the platform
 * nests its packages one level deeper), the release overlay copies `packages/.` wholesale into
 * `packages/evolution/`, and verify-arch-guards reported 399 violations on the PLATFORM's sources
 * (tag run 42974791881).
 *
 * Two details make this shape invisible to the obvious check, and both are covered here:
 *   - a junction is `isDirectory() === false`, `isSymbolicLink() === true` in a Node Dirent, so a scan
 *     that filters on isDirectory() skips exactly the residue that caused the incident;
 *   - the copy landed at the repo root as well as under the package root.
 * Therefore every directory-or-link under the package root must be a published package or a DECLARED
 * non-package directory, and (in the mirror layout) every directory-or-link at the repo root must be a
 * declared root directory. A stray grouping directory is a failure, not a listing.
 *
 * Usage: node packages/scripts/verify-package-map.mjs [packages-root]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  RETIRED_PACKAGE_DIRS,
  ROOT_NON_PACKAGE_DIRS,
  isNonPackageDir,
  publishableDirs,
} from './lib-family-packages.mjs'

const root = process.argv[2] ?? 'packages'
const readmePath = join(root, 'README.md')
const lines = readFileSync(readmePath, 'utf8').split(String.fromCharCode(10))
const start = lines.findIndex((line) => line.trim() === '## Package map')
if (start < 0) {
  console.error('verify-package-map: ' + readmePath + ' carries no "## Package map" section')
  process.exit(1)
}
const mentioned = new Set()
for (let i = start + 1; i < lines.length; i += 1) {
  const line = lines[i]
  if (line.startsWith('## ')) break
  if (!line.startsWith('|')) continue
  const first = line.split('|')[1] ?? ''
  for (const match of first.matchAll(/`([a-z][a-z0-9-]*)`/g)) mentioned.add(match[1])
}

const dirs = publishableDirs(root)
const missing = dirs.filter((dir) => !mentioned.has(dir))
const extra = [...mentioned].filter((name) => !dirs.includes(name))
const problems = []
for (const name of missing) problems.push(readmePath + ' has no row for the published package ' + name)
for (const name of extra) problems.push(readmePath + ' names ' + name + ', which is not a published package')

/** Directory-ish entries: a real directory OR a link to one (a junction is only the latter). */
const dirLike = (entry) => entry.isDirectory() || entry.isSymbolicLink()

// The tree half, package root: nothing here that is neither published nor declared non-package.
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!dirLike(entry)) continue
  const name = entry.name
  if (dirs.includes(name) || isNonPackageDir(name) || RETIRED_PACKAGE_DIRS.has(name)) continue
  problems.push(entry.isSymbolicLink()
    ? join(root, name) + ' is a junction/symlink inside the package root (the platform test wiring '
      + 'setup-mirror-tests.mjs creates): git follows it and commits the whole target tree, and the '
      + 'release overlay would copy it into the platform tree as family code — remove it before tagging'
    : join(root, name) + ' is neither a published package (no package.json) nor a declared non-package '
      + 'directory (NON_PACKAGE_DIRS / RETIRED_PACKAGE_DIRS in lib-family-packages.mjs) — the release '
      + 'overlay copies the whole package root into the platform tree, so this tree would ship as family code')
}

// The tree half, repository root: the mirror layout carries a repository, not a package container.
// Skipped in the overlay layout (there the parent is the platform checkout, whose own packages are
// the context, not this repo's shape).
if (basename(resolve(root)) === 'packages') {
  const repoRoot = dirname(resolve(root))
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!dirLike(entry)) continue
    if (entry.name.startsWith('.') || ROOT_NON_PACKAGE_DIRS.has(entry.name)) continue
    problems.push(join(repoRoot, entry.name) + ' sits at the repository root but is not a declared root '
      + 'directory (ROOT_NON_PACKAGE_DIRS in lib-family-packages.mjs): platform grouping directories and '
      + 'scratch trees do not belong in the mirror — the 0.43.2-rc.1 release committed 22 of them')
  }
}

// F-103 discipline: a scan that found nothing is not a pass, it is a vacuum.
if (dirs.length === 0) problems.push(root + ' carries no publishable package — a map check over an empty tree proves nothing')

if (problems.length > 0) {
  console.error('verify-package-map: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-package-map: OK — ' + dirs.length + ' published package(s), all named in the map, no stray directory')
