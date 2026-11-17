#!/usr/bin/env node
/**
 * Phase 0 baseline verifier.
 *
 * Checks the recorded v0.49.0 tag, the architecture-optimization docs, and the
 * three characterization specs in an overlay checkout. It fails on a tag/doc
 * drift or a per-spec test-count change, so a later refactor cannot silently
 * "move the baseline".
 *
 * Usage:
 *   node packages/scripts/verify-architecture-baseline.mjs --overlay <overlay-root> [--skip-tests] [--json]
 *
 * The overlay is the checkout that carries platform dependencies and built
 * `packages/evolution` (D:\line-b6 on this machine). Spec paths in the baseline
 * are relative to that overlay.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const overlayArg = option('--overlay')
if (overlayArg === undefined || overlayArg.startsWith('--')) {
  console.error('usage: verify-architecture-baseline.mjs --overlay <overlay-root> [--skip-tests] [--json]')
  process.exit(2)
}
const overlay = resolve(overlayArg)
const baselinePath = join(root, 'packages', 'scripts', 'architecture-baseline.json')
if (!existsSync(baselinePath)) {
  console.error('baseline missing: ' + baselinePath)
  process.exit(2)
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const failures = []

// 1. Tag and commit.
const tag = spawnSync('git', ['-C', root, 'rev-parse', baseline.tag + '^{commit}'], { encoding: 'utf8' })
if (tag.status !== 0) failures.push('git tag not found: ' + baseline.tag)
else if (!tag.stdout.trim().startsWith(baseline.commit)) {
  failures.push('tag ' + baseline.tag + ' = ' + tag.stdout.trim() + ', baseline wants ' + baseline.commit)
}

// 2. Required docs.
for (const rel of baseline.requiredDocs) {
  if (!existsSync(join(root, rel))) failures.push('required doc missing: ' + rel)
}

// 3. Characterization specs.
const results = []
if (!args.includes('--skip-tests')) {
  if (!existsSync(join(overlay, 'node_modules', 'vitest', 'vitest.mjs'))) {
    failures.push('vitest missing under overlay: ' + overlay)
  } else {
    const outDir = mkdtempSync(join(tmpdir(), 'dsh-baseline-'))
    const outFile = join(outDir, 'results.json')
    try {
      const specs = baseline.specs.map((spec) => spec.path)
      const run = spawnSync(process.execPath, [
        join(overlay, 'node_modules', 'vitest', 'vitest.mjs'),
        'run', ...specs,
        '--maxWorkers=1',
        '--reporter=json',
        '--outputFile=' + outFile,
      ], { cwd: overlay, stdio: 'inherit', env: process.env })
      if (!existsSync(outFile)) {
        failures.push('vitest produced no JSON (exit ' + String(run.status) + ')')
      } else {
        const json = JSON.parse(readFileSync(outFile, 'utf8'))
        const byPath = new Map()
        for (const file of json.testResults ?? []) {
          const normalized = String(file.name).replaceAll('\\', '/')
          const marker = '/packages/evolution/'
          const idx = normalized.indexOf(marker)
          const key = idx >= 0 ? 'packages/evolution/' + normalized.slice(idx + marker.length) : normalized
          byPath.set(key, Array.isArray(file.assertionResults) ? file.assertionResults.length : 0)
        }
        for (const spec of baseline.specs) {
          const actual = byPath.get(spec.path)
          results.push({ spec: spec.path, expected: spec.tests, actual: actual ?? null })
          if (actual === undefined || actual === null) failures.push('spec produced no result: ' + spec.path)
          else if (actual !== spec.tests) failures.push(spec.path + ': expected ' + spec.tests + ' tests, got ' + actual)
        }
        if (json.numFailedTests !== 0) {
          const failed = []
          for (const file of json.testResults ?? []) {
            for (const test of file.assertionResults ?? []) {
              if (test.status === 'failed') failed.push(test.fullName)
            }
          }
          failures.push('vitest failed tests: ' + String(json.numFailedTests)
            + (failed.length === 0 ? '' : ' (' + failed.join(' | ') + ')'))
        }
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }
}

const report = {
  ok: failures.length === 0,
  tag: baseline.tag,
  commit: baseline.commit,
  overlay,
  docs: baseline.requiredDocs.length,
  specs: results,
  failures,
}
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
else {
  console.log('baseline ' + baseline.tag + ' / ' + baseline.commit)
  console.log('docs: ' + baseline.requiredDocs.length + ' checked')
  for (const r of results) console.log('spec ' + r.spec + ': ' + r.actual + '/' + r.expected)
  console.log(report.ok ? 'OK' : 'FAIL')
}
if (!report.ok) {
  for (const failure of failures) console.error(' - ' + failure)
  process.exit(1)
}
