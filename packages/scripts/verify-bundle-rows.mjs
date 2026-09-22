#!/usr/bin/env node
/**
 * verify-bundle-rows — the three bundle patches are GENERATED artifacts.
 *
 * `scripts/bundle-rows.json` is the single source for the `- insert:` row list of
 * evolution-all / -host / -preset: membership per install form, one verbatim body per
 * row, per-form prose. gen-bundle-patches.mjs renders the three patch files from it, so
 * a hand edit of any patch is drift by definition — the failure the older three-way
 * byte-identity test could only catch after two files had already disagreed.
 *
 * The generator is invoked with `--check` (the verify-param-registry precedent) instead
 * of re-rendering here, so the gate and a maintainer's manual run share one renderer.
 *
 * Usage (works from BOTH layouts — dev `packages/evolution/scripts/…`, flat mirror
 * `packages/scripts/…`): node <scripts-dir>/verify-bundle-rows.mjs <evolution-root> [--strict]
 *   --strict  accepted for uniformity with the other verifiers; this one always fails loud.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Bundle layers whose patch files come out of the roster. */
const FORMS = ['all', 'host', 'preset']

const argv = process.argv.slice(2)
const root = resolve(argv.find((arg) => !arg.startsWith('--')) ?? 'packages')
const problems = []

const rosterPath = join(root, 'scripts', 'bundle-rows.json')
if (!existsSync(rosterPath)) {
  problems.push('missing row roster ' + rosterPath)
} else {
  try {
    const roster = JSON.parse(readFileSync(rosterPath, 'utf8'))
    for (const form of FORMS) {
      if (roster.forms === undefined || roster.forms[form] === undefined) problems.push('roster declares no form "' + form + '"')
    }
    if (!Array.isArray(roster.rows) || roster.rows.length === 0) problems.push('roster carries no rows')
  } catch (error) {
    problems.push('roster is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
}

if (problems.length === 0) {
  const generator = join(dirname(fileURLToPath(import.meta.url)), 'gen-bundle-patches.mjs')
  try {
    execFileSync(process.execPath, [generator, root, '--check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const stderr = error !== null && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : String(error)
    const first = stderr.split('\n').map((line) => line.trim()).filter((line) => line !== '')[0] ?? 'generator failed'
    problems.push('bundle patches are not current (run gen-bundle-patches.mjs): ' + first)
  }
}

if (problems.length > 0) {
  console.error('verify-bundle-rows: ' + problems.length + ' problem(s)')
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log('verify-bundle-rows: OK — the three bundle patches match scripts/bundle-rows.json')
