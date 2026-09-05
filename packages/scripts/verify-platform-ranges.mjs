#!/usr/bin/env node
/**
 * N-2 platform-range guard (second-round audit §5.2): every manifest staged
 * for publish must declare each non-family `@deepseek-ai/dsh-*` dependency /
 * peer / dev / optional range as exactly `^<platform-version>` — the same
 * platform version the released-upstream compat gate validates against
 * (`dsh-v<platform-version>` git tag). A drift between the release metadata
 * and the compat anchor repeats the rc.54 defect: `^0.1.0-rc.6` does not
 * match `0.1.1-rc.2` under semver prerelease rules, so the declared support
 * range silently diverges from the validated platform.
 *
 * Family-scoped packages (`<our-scope>/dsh-*`, e.g. `@lmzhen/dsh-*` after
 * the publish scope rewrite) are exempt: they range against the family's own
 * `RELEASE_VERSION`.
 *
 * Usage:
 *   node packages/scripts/verify-platform-ranges.mjs \
 *     --platform-version 0.1.1-rc.2 \
 *     --manifest-dir packages/evolution/dist \
 *     [--our-scope @lmzhen]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

function requireArg(name) {
  const value = arg(name)
  if (!value) throw new Error(`verify-platform-ranges: missing required ${name}`)
  return value
}

const platformVersion = requireArg('--platform-version')
const manifestDir = requireArg('--manifest-dir')
const ourScope = arg('--our-scope', '@lmzhen')
const familyPrefixes = arg('--family-prefixes', `${ourScope}/dsh-`)
const expected = `^${platformVersion}`

// M-7 (v3 audit): when the publish scope IS the platform scope, family and
// platform packages are indistinguishable by prefix — the guard would exempt
// everything and go silent. Fail loud instead of vacuous-passing.
if (ourScope === '@deepseek-ai') {
  console.error('verify-platform-ranges: --our-scope @deepseek-ai cannot distinguish family from platform deps; pass --family-prefixes (e.g. @lmzhen/dsh-)')
  process.exit(1)
}

const failures = []
let checked = 0
let scanned = 0

function isPlatformDep(name) {
  return name.startsWith('@deepseek-ai/dsh-') && !name.startsWith(familyPrefixes)
}

for (const dir of readdirSync(manifestDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const manifestPath = join(manifestDir, dir.name, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    continue
  }
  scanned += 1
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (!isPlatformDep(name)) continue
      checked += 1
      if (range !== expected) {
        failures.push(`${manifest.name}: ${section}.${name} = ${range} (expected ${expected})`)
      }
    }
  }
}

// F-103: a flat tarball dir (or a missing path) has no package.json subdirs, so
// the old guard scanned `packages/evolution/dist` and counted 0 ranges —
// a vacuous pass that never validated anything. Fail loud when no manifest was
// actually scanned rather than letting an unvalidated build go green.
if (scanned === 0) {
  console.error(`verify-platform-ranges: no package manifest found under ${manifestDir} (0 directories with a readable package.json) — checked 0 packages and the guard would pass vacuously. Point --manifest-dir at the staged per-package tree (e.g. ${manifestDir}/../.release-staging) that actually holds one package.json per package.`)
  process.exit(1)
}

if (failures.length > 0) {
  console.error(`verify-platform-ranges: ${failures.length} platform dependency range(s) drifted from ^${platformVersion}:`)
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`verify-platform-ranges: OK — scanned ${scanned} package manifest(s), ${checked} @deepseek-ai/dsh-* platform range(s) all ^${platformVersion}`)
