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
 * Support-window statement, and why this gate IS that statement: `^<version>`
 * is not a range that grows into later platform lines. Under node-semver's
 * prerelease-admission rule a prerelease version satisfies a range only
 * through a comparator carrying the SAME major.minor.patch, so `^0.1.1-rc.2`
 * rejects `0.1.5-rc.2` while admitting stable `0.1.5`. The declared window is
 * therefore exactly one anchor plus the stable releases below the caret's
 * upper bound — never a family of anchors. That rule is asserted below
 * (`assertSupportWindow`) rather than described here: widening the window
 * requires a second validated CI line, not a looser range.
 *
 * Family-scoped packages (`<our-scope>/dsh-*`, e.g. `@lmzhen/dsh-*` after
 * the publish scope rewrite) are exempt: they range against the family's own
 * `RELEASE_VERSION`.
 *
 * Usage:
 *   node packages/scripts/verify-platform-ranges.mjs \
 *     --platform-version 0.1.5-rc.2 \
 *     --manifest-dir packages/evolution/dist \
 *     [--our-scope @lmzhen] \
 *     [--previous-anchor 0.1.1-rc.2]
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

/** Parse `major.minor.patch[-prerelease]`; `null` for anything else.
 * @param text - a version string.
 * @returns the parsed fields, or `null` when the text is not a semver version. */
function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null }
}

/** Order two prerelease identifiers per semver §11.4 (numeric < alphanumeric).
 * @param a - one dotted prerelease field.
 * @param b - the other dotted prerelease field.
 * @returns negative, zero or positive, like a comparator. */
function comparePrereleaseIdentifier(a, b) {
  const numericA = /^\d+$/.test(a)
  const numericB = /^\d+$/.test(b)
  if (numericA && numericB) return Number(a) - Number(b)
  if (numericA !== numericB) return numericA ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Order two parsed versions, prerelease-aware.
 * @param a - a parsed version.
 * @param b - the other parsed version.
 * @returns negative, zero or positive, like a comparator. */
function compareVersions(a, b) {
  for (const field of ['major', 'minor', 'patch']) {
    if (a[field] !== b[field]) return a[field] - b[field]
  }
  if (a.prerelease === null || b.prerelease === null) {
    return a.prerelease === null && b.prerelease === null ? 0 : a.prerelease === null ? 1 : -1
  }
  const left = a.prerelease.split('.')
  const right = b.prerelease.split('.')
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    const order = comparePrereleaseIdentifier(left[index], right[index])
    if (order !== 0) return order
  }
  return 0
}

/** The caret's exclusive upper bound (semver: `^0.1.5` ↦ `<0.2.0`).
 * @param anchor - a parsed version.
 * @returns the exclusive upper bound as a parsed version. */
function caretUpperBound(anchor) {
  if (anchor.major > 0) return { major: anchor.major + 1, minor: 0, patch: 0, prerelease: null }
  if (anchor.minor > 0) return { major: 0, minor: anchor.minor + 1, patch: 0, prerelease: null }
  return { major: 0, minor: 0, patch: anchor.patch + 1, prerelease: null }
}

/** Whether `^<anchor>` admits `candidate`.
 *
 * Covers exactly the two facts this gate asserts and no more: node-semver's
 * prerelease-admission rule (a prerelease candidate needs a comparator with the
 * same major.minor.patch, so it is admitted only from the anchor's own tuple)
 * and the caret's upper bound for stable candidates. A full range evaluator is
 * deliberately absent — the gate accepts one range form, `^<version>`.
 *
 * @param anchor - the platform version the release metadata pins.
 * @param candidate - the version to test for admission.
 * @returns whether the anchor's caret range admits the candidate.
 */
function caretAdmits(anchor, candidate) {
  const target = parseVersion(anchor)
  const version = parseVersion(candidate)
  if (target === null || version === null) return false
  if (version.prerelease !== null) {
    const sameTuple = version.major === target.major && version.minor === target.minor && version.patch === target.patch
    return sameTuple && compareVersions(version, target) >= 0
  }
  return compareVersions(version, caretUpperBound(target)) < 0 && compareVersions(version, target) >= 0
}

/** Recorded semver outcomes (audit v33 §P1-1, measured against semver@7.8.5).
 * The predicate above must reproduce every one of them; a mismatch means this
 * gate's model of the support window no longer matches npm's, and the
 * "declared range == validated anchor" claim is unverified. */
const ADMISSION_CASES = [
  { range: '^0.1.1-rc.2', version: '0.1.5-rc.2', admits: false },
  { range: '^0.1.1-rc.2', version: '0.1.5', admits: true },
  { range: '^0.1.1-rc.2', version: '0.1.1-rc.3', admits: true },
  { range: '^0.1.5-rc.2', version: '0.1.5-rc.2', admits: true },
]

/** The preceding-patch prerelease of a prerelease anchor (`0.1.5-rc.2` ↦
 * `0.1.4-rc.2`) — the immediately older anchor line, derived so the cross-anchor
 * assertion needs no hand-copied predecessor.
 * @param anchor - the platform version.
 * @returns the derived predecessor, or `null` when the anchor is stable. */
function precedingAnchor(anchor) {
  const parsed = parseVersion(anchor)
  if (parsed === null || parsed.prerelease === null || parsed.patch === 0) return null
  return `${parsed.major}.${parsed.minor}.${parsed.patch - 1}-${parsed.prerelease}`
}

/** Assert the support-window rule this gate exists to declare (G1.2).
 *
 * Fails loud when: the predicate disagrees with a recorded semver outcome; the
 * anchor is not inside its own range; a derived predecessor anchor is admitted
 * (the window grew silently); or `--previous-anchor` is admitted — that last
 * check is the cross-anchor fact `^0.1.1-rc.2` rejects `0.1.5-rc.2`, applied to
 * the pair this release actually moves between.
 *
 * @param anchor - the platform version the release metadata pins.
 */
function assertSupportWindow(anchor) {
  const range = `^${anchor}`
  const problems = []
  for (const item of ADMISSION_CASES) {
    const actual = caretAdmits(item.range.slice(1), item.version)
    if (actual !== item.admits) {
      problems.push(`predicate says ${item.range} vs ${item.version} = ${actual}, semver@7.8.5 measured ${item.admits}`)
    }
  }
  if (!caretAdmits(anchor, anchor)) problems.push(`${range} does not admit its own anchor ${anchor}`)
  const predecessor = precedingAnchor(anchor)
  if (predecessor !== null && caretAdmits(anchor, predecessor)) {
    problems.push(`${range} admits the preceding anchor ${predecessor} — the declared window spans more than one anchor`)
  }
  const previous = arg('--previous-anchor')
  if (previous !== '') {
    if (!caretAdmits(anchor, previous)) {
      console.log(`verify-platform-ranges: support window — ${range} rejects the previous anchor ${previous} (prerelease-admission rule; the declared window is exactly this anchor)`)
    } else {
      problems.push(`${range} admits the previous anchor ${previous} — declared and validated platform lines overlap`)
    }
  }
  if (problems.length > 0) {
    console.error(`verify-platform-ranges: ${problems.length} support-window assertion(s) failed for ${anchor}:`)
    console.error(problems.join('\n'))
    process.exit(1)
  }
}

assertSupportWindow(platformVersion)

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

// P3 (v15): the sibling of the F-103 vacuous pass — manifests exist but NONE
// carries a @deepseek-ai/dsh-* platform dependency (e.g. every dependency
// rewritten away upstream). "OK — 0 range(s)" would validate nothing.
if (checked === 0) {
  console.error(`verify-platform-ranges: ${scanned} manifest(s) scanned under ${manifestDir} but 0 @deepseek-ai/dsh-* platform dependency ranges found — nothing to verify (vacuous pass); check the staged tree.`)
  process.exit(1)
}

if (failures.length > 0) {
  console.error(`verify-platform-ranges: ${failures.length} platform dependency range(s) drifted from ^${platformVersion}:`)
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`verify-platform-ranges: OK — scanned ${scanned} package manifest(s), ${checked} @deepseek-ai/dsh-* platform range(s) all ^${platformVersion}`)
