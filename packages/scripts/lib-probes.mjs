/**
 * G7-S1: the probe registry reader. probes.json is the ONE hand-authored source;
 * gen-gate-manifest merges it into gate-manifest.probes (the runtime registry consumers read).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const PROBE_KINDS = Object.freeze(['decl', 'beh'])
export const PROBE_EVIDENCE = Object.freeze(['A', 'B'])

export function probesPath(root) { return join(root, 'scripts', 'probes.json') }

export function readProbes(root) {
  const file = probesPath(root)
  if (!existsSync(file)) throw new Error('probe registry: missing ' + file)
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed.probes) || parsed.probes.length === 0) {
    throw new Error('probe registry: probes.json must declare a non-empty probes[] (an empty registry is a silent gate)')
  }
  return parsed.probes
}

/** Structural validation; returns the problem list (empty = OK). */
export function probeProblems(root, probes) {
  const problems = []
  const seen = new Set()
  for (const probe of probes) {
    const where = 'probe ' + String(probe && probe.id)
    if (typeof probe.id !== 'string' || probe.id === '') { problems.push(where + ': id must be a non-empty string'); continue }
    if (seen.has(probe.id)) problems.push(where + ': duplicate id')
    seen.add(probe.id)
    if (!PROBE_KINDS.includes(probe.kind)) problems.push(where + ': kind must be one of ' + PROBE_KINDS.join('/'))
    if (!PROBE_EVIDENCE.includes(probe.evidence)) problems.push(where + ': evidence must be A or B')
    if (typeof probe.owner !== 'string' || probe.owner === '') problems.push(where + ': owner is required')
    if (typeof probe.note !== 'string' || probe.note === '') problems.push(where + ': note is required')
    // The registry is written ROOT-relative in the mirror (`packages/<pkg>/...`) and copied verbatim
    // into the CI overlay, where the same file lives at `packages/evolution/<pkg>/...`. Resolve
    // against the tree the script was pointed at first, then against the mirror-style root the
    // caller may have passed (`<root>/../<file>`); both layouts must judge the SAME registry.
    const layoutCandidates = (file) => [join(root, file.replace(/^packages\//, '')), join(root, '..', file)]
    const existsInLayout = (file) => layoutCandidates(file).some((candidate) => existsSync(candidate))
    if (!Array.isArray(probe.files) || probe.files.length === 0) problems.push(where + ': files[] is required (the specs/scripts that prove the claim)')
    else for (const file of probe.files) if (!existsInLayout(file)) problems.push(where + ': missing ' + file)
    if (typeof probe.mutation !== 'string' || probe.mutation === '') problems.push(where + ': mutation fixture is required (a probe without a red direction is not a probe)')
    else if (!existsInLayout(probe.mutation)) problems.push(where + ': missing mutation fixture ' + probe.mutation)
  }
  return problems
}

/** Test-title convention: each probe id is the spec title prefix the verification runner greps. */
export function probeTitle(probe) { return '[' + probe.id + ']' }

/** The tree that holds `node_modules` (the overlay checkout, or the mirror root). */
export function treeRootOf(root) { return resolve(root, '..') }

/**
 * The overlay checkout root, detected by BOTH marker halves the probe runner needs: the platform
 * tree (`packages/boot/app-boot`) and `node_modules/vitest`. Candidates: the overlay root is two
 * levels above the scripts dir (`<root>/../..`), the mirror root one (`<root>/..`).
 */
export function overlayRootOf(root) {
  const candidates = [resolve(root, '..', '..'), resolve(root, '..')]
  return candidates.find((dir) => existsSync(join(dir, 'packages', 'boot', 'app-boot')) && existsSync(join(dir, 'node_modules', 'vitest'))) ?? null
}

/**
 * Whether the tree carries the platform overlay the beh probes need. The mirror is the publish
 * carrier only, so the probe runner answers CANNOT-DECIDE there instead of pretending a schema
 * lint is an execution.
 */
export function overlayAvailable(root) { return overlayRootOf(root) !== null }

/** Resolve a registry path in either layout: root-relative first, then mirror-style root/../file. */
export function resolveLayoutPath(root, file) {
  const candidates = [join(root, file.replace(/^packages\//, '')), join(root, '..', file)]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * How the probe is run: the same vitest form the CI action uses (no machine-local config), one
 * file set and the probe id as the test-name pattern. A skipped probe is not a pass, so callers
 * compare the child's exit code rather than trusting vitest's summary.
 */
export function probeCommand(entry, root) {
  const treeRoot = overlayRootOf(root) ?? treeRootOf(root)
  const files = entry.files.map((file) => {
    const resolved = resolveLayoutPath(root, file)
    if (resolved === null) throw new Error('probe ' + String(entry.id) + ': missing ' + file)
    return resolved
  })
  // A probe may be a guard SCRIPT (packages/scripts/verify-*.mjs) rather than a spec: run the script
  // with the packages root it declares, not vitest (vitest would collect zero tests and exit 0).
  if (files.length === 1 && files[0].endsWith('.mjs')) return { argv: [process.execPath, files[0], root], cwd: treeRoot }
  const vitest = join(treeRoot, 'node_modules', 'vitest', 'vitest.mjs')
  // W9 C2 (test-title=id) was NOT implemented in the first probe batch: the specs are ordinary spec
  // files. Run the registered file set as a whole (a `-t <id>` name filter matches nothing and a
  // zero-test run exits 0 - the exact vacuous pass the registry exists to prevent).
  return { argv: [process.execPath, vitest, 'run', ...files, '--maxWorkers=2', '--testTimeout=30000'], cwd: treeRoot }
}

/**
 * Read and structurally validate a probe's mutation fixture.
 * @returns { fixture: object, path: string, problems: string[] }
 */
export function readMutationFixture(root, entry) {
  const problems = []
  const path = resolveLayoutPath(root, entry.mutation)
  if (path === null) return { fixture: null, path: null, problems: ['missing mutation fixture ' + String(entry.mutation)] }
  let fixture
  try { fixture = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { return { fixture: null, path, problems: ['unreadable mutation fixture: ' + (error instanceof Error ? error.message : String(error))] } }
  if (fixture === null || typeof fixture !== 'object') problems.push('fixture is not an object')
  else {
    if (fixture.probe !== entry.id) problems.push('fixture.probe ' + JSON.stringify(fixture.probe) + ' does not equal the registry id ' + JSON.stringify(entry.id))
    if (!Array.isArray(fixture.edits) || fixture.edits.length === 0) problems.push('fixture.edits[] must carry at least one edit')
    else fixture.edits.forEach((edit, index) => {
      const where = 'edits[' + String(index) + ']'
      if (edit === null || typeof edit !== 'object') { problems.push(where + ' is not an object'); return }
      if (typeof edit.file !== 'string' || !/^packages\/(evolution|scripts)/.test(edit.file)) problems.push(where + '.file must be under packages/evolution/** or packages/scripts/**')
      else if (resolveLayoutPath(root, edit.file) === null) problems.push(where + '.file does not exist: ' + edit.file)
      if (typeof edit.find !== 'string' || edit.find === '') problems.push(where + '.find must be a non-empty string')
      if (typeof edit.replace !== 'string') problems.push(where + '.replace must be a string')
      if (edit.find === edit.replace) problems.push(where + ' is an equal-value patch (nothing can be proven)')
    })
    if (fixture.expect !== undefined && fixture.expect !== 'red') problems.push('fixture.expect must be "red" when present (only a red direction is proof)')
    if (fixture.timeoutMs !== undefined && (typeof fixture.timeoutMs !== 'number' || fixture.timeoutMs <= 0)) problems.push('fixture.timeoutMs must be a positive number')
  }
  return { fixture, path, problems }
}

/**
 * The ledger signature of one probe: the bytes of every spec file plus the fixture it mutates.
 * A record whose signature no longer matches is stale evidence, not coverage.
 */
export function probeSignature(root, entry) {
  const hash = createHash('sha256')
  for (const file of entry.files) {
    const resolved = resolveLayoutPath(root, file)
    hash.update(resolved === null ? 'missing:' + file : readFileSync(resolved))
    hash.update(String.fromCharCode(10))
  }
  const fixture = resolveLayoutPath(root, entry.mutation)
  hash.update(fixture === null ? 'missing:' + String(entry.mutation) : readFileSync(fixture))
  return hash.digest('hex')
}