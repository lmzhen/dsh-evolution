/**
 * Does every package the release script would publish pass the installer's
 * discovery rule? (v43 audit S1-2.)
 *
 * Usage: node packages/scripts/verify-package-discovery.mjs <packages-root> [--strict]
 *
 * The two rules live in lib-family-packages.mjs so this gate and the installer
 * cannot drift: a package that would be published but never installed is a
 * SILENT gap (no error, no warning, no missing-file symptom) — exactly the
 * class this check exists to convert into a red gate.
 * @module verify-package-discovery
 */
import { installerAccepts, manifestName, publishableDirs } from './lib-family-packages.mjs'

const argv = process.argv.slice(2)
const root = argv[0]
const strict = argv.includes('--strict')
if (typeof root !== 'string' || root === '') {
  console.error('usage: node verify-package-discovery.mjs <packages-root> [--strict]')
  process.exit(1)
}

const dirs = publishableDirs(root)
const unreadable = []
const rejected = []
for (const dir of dirs) {
  const name = manifestName(root, dir)
  if (name === null) { unreadable.push(dir); continue }
  // The installer compares the SCOPED name (install-layered.mjs:479 rescopes
  // before matching); the mirror manifests carry the dev scope, so normalise
  // both sides to the unscoped tail before applying the prefix rule.
  const unscoped = name.replace(/^@[^/]+\//, '')
  if (!installerAccepts(unscoped)) rejected.push(`${dir} (${name})`)
}

const summary = `verify-package-discovery: publishable=${dirs.length} rejected=${rejected.length} unreadable=${unreadable.length}`
if (unreadable.length > 0) {
  console.error(`${summary}\n  manifest unreadable: ${unreadable.join(', ')}`)
  process.exit(1)
}
if (rejected.length > 0) {
  const message = `${summary}\n  published but NOT installable by the source installer:`
    + `\n    ${rejected.join('\n    ')}`
    + '\n  Fix: add the package\'s prefix to EVOLUTION_PREFIXES in lib-family-packages.mjs,'
    + ' or rename the package so it matches an existing family prefix.'
  if (strict) { console.error(message); process.exit(1) }
  console.warn(message)
}
console.log(summary)
