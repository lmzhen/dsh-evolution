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
 *
 * v46 S1.7 (finding T7-13): the generator proves the patches are CURRENT; nothing proved
 * they are PARSEABLE. A stray tab or a broken indent is valid-looking text that only fails
 * when the platform reads the patch at boot, so this guard now also checks the FORM of every
 * patch line (always) and, when a YAML parser is resolvable next to the tree, parses each
 * patch (the platform's `!!js <expr>` values are first normalised to a plain scalar — they are
 * not core YAML). The missing-parser case is REPORTED, never folded into a pass.
 *
 * Usage (works from BOTH layouts — dev `packages/evolution/scripts/…`, flat mirror
 * `packages/scripts/…`): node <scripts-dir>/verify-bundle-rows.mjs <evolution-root> [--strict]
 *   --strict  accepted for uniformity with the other verifiers; this one always fails loud.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

// v46 S1.7 (finding T7-13): form invariants that need no parser, then the YAML parse.
const form = []
for (const form_ of FORMS) {
  const file = join(root, 'evolution-' + form_, 'cordis.patch.yml')
  if (!existsSync(file)) { form.push('missing patch ' + file); continue }
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const [index, line] of lines.entries()) {
    // A tab in a comment is inert; a tab in a content line is what YAML refuses.
    if (line.includes('\t') && !line.trimStart().startsWith('#')) form.push(file + ':' + (index + 1) + ' carries a tab — YAML forbids a tab in indentation')
    if (/[ ]+$/.test(line)) form.push(file + ':' + (index + 1) + ' carries trailing whitespace')
    if (/!!js\s*$/.test(line)) form.push(file + ':' + (index + 1) + ' opens a !!js tag with no expression')
  }
  if (!lines.some((line) => /^\s*- insert:\s*$/.test(line))) form.push(file + ' carries no "- insert:" section — a patch with nothing to insert is drift')
}

let yaml = null
let yamlSpec = ''
try { yaml = await import('yaml'); yamlSpec = 'yaml (script-relative)' } catch { /* no parser next to the script */ }
if (yaml === null) {
  for (const base of [join(root, '..'), root, join(root, 'evolution-core')]) {
    try {
      const resolved = createRequire(join(base, 'package.json')).resolve('yaml')
      yaml = await import(pathToFileURL(resolved).href)
      yamlSpec = resolved
      break
    } catch { /* try the next base */ }
  }
}
if (yaml === null) {
  console.log('verify-bundle-rows: form checks ran; the YAML half did NOT run — this layout resolves no "yaml" parser from ' + resolve(root) + '. The gate runs that half in the CI overlay (the upstream tree carries one); this run is the weaker of the two and says so.')
} else {
  for (const form_ of FORMS) {
    const file = join(root, 'evolution-' + form_, 'cordis.patch.yml')
    if (!existsSync(file)) continue
    // `!!js dshHomePath(...)` is the platform's own tag, not core YAML: normalise it to a
    // plain scalar so the rest of the document is judged as YAML.
    const text = readFileSync(file, 'utf8').replace(/!!js\s+.+$/gm, 'js_value')
    try {
      const doc = yaml.parse(text)
      if (!Array.isArray(doc)) form.push(file + ' does not parse to a top-level sequence')
    } catch (error) {
      form.push(file + ' is not valid YAML: ' + (error instanceof Error ? error.message.split('\n')[0] : String(error)))
    }
  }
  console.log('verify-bundle-rows: YAML semantics checked via ' + yamlSpec)
}
problems.push(...form)

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

console.log('verify-bundle-rows: OK — the three bundle patches match scripts/bundle-rows.json'
  + (yaml === null ? ' (form checks only — no YAML parser resolvable in this layout)' : ''))
