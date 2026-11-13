/**
 * Probe baseline evidence — consume the suite's own JSON report instead of re-running each
 * probe's baseline.
 *
 * The mutation registry's contract is "a red only counts when the check was green BEFORE the
 * mutation". The green baseline is exactly the suite run that already happened in the same job;
 * re-running it per probe made the probe lane twice as expensive as it needed to be (W10 §15).
 *
 * `readSuiteBaseline(file, root)` reads a vitest `--reporter=json` report; `baselineForProbe`
 * answers one of three things for a probe:
 *   - green     : every spec file of the probe passed with at least one test
 *   - cannot-decide: a file is missing / red / zero-test (the caller must say so, never pass)
 *   - fallback  : the probe has no spec file (a guard-script probe), so the caller runs it
 *
 * Paths are normalised against the overlay tree the report was produced in, and compared
 * case-insensitively on Windows, because vitest reports absolute paths.
 */
import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { overlayRootOf, resolveLayoutPath, treeRootOf } from './lib-probes.mjs'

const normalise = (value) => value.split(sep).join('/').toLowerCase()

/** Read a vitest JSON report into a map keyed by overlay-relative spec path. */
export function readSuiteBaseline(file, root) {
  let parsed
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
    return { ok: false, reason: 'unreadable JSON: ' + (error instanceof Error ? error.message : String(error)) }
  }
  const results = Array.isArray(parsed?.testResults) ? parsed.testResults : null
  if (results === null) return { ok: false, reason: 'not a vitest JSON report (no testResults[])' }
  const tree = overlayRootOf(root) ?? treeRootOf(root)
  const byFile = new Map()
  for (const entry of results) {
    if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') continue
    const key = normalise(relative(tree, resolve(entry.name)))
    byFile.set(key, {
      status: typeof entry.status === 'string' ? entry.status : 'unknown',
      tests: Array.isArray(entry.assertionResults) ? entry.assertionResults.length : 0,
    })
  }
  return { ok: true, file, tree, byFile, total: byFile.size }
}

/** Decide a probe's baseline from the suite evidence: green | cannot-decide | fallback. */
export function baselineForProbe(probe, root, evidence) {
  const specFiles = (Array.isArray(probe.files) ? probe.files : []).filter((file) => /\.spec\.tsx?$/.test(file))
  if (specFiles.length === 0) return { kind: 'fallback', reason: 'probe has no spec file (guard-script probe)' }
  const missing = []
  const red = []
  const empty = []
  for (const file of specFiles) {
    const resolved = resolveLayoutPath(root, file)
    if (resolved === null) { missing.push(file); continue }
    const key = normalise(relative(evidence.tree, resolved))
    const record = evidence.byFile.get(key)
    if (record === undefined) { missing.push(key); continue }
    if (record.status !== 'passed') red.push(key + ' (' + record.status + ')')
    else if (record.tests === 0) empty.push(key)
  }
  if (missing.length > 0) return { kind: 'cannot-decide', reason: 'baseline evidence missing for ' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? ' …' : '') }
  if (red.length > 0) return { kind: 'cannot-decide', reason: 'baseline evidence red for ' + red.slice(0, 3).join(', ') + (red.length > 3 ? ' …' : '') }
  if (empty.length > 0) return { kind: 'cannot-decide', reason: 'baseline evidence has zero tests for ' + empty.slice(0, 3).join(', ') + (empty.length > 3 ? ' …' : '') }
  return { kind: 'green' }
}
