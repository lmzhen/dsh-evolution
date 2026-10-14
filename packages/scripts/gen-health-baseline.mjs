#!/usr/bin/env node
/**
 * gen-health-baseline.mjs (G4/S2): the PRODUCER of scripts/reports/health-baseline.json.
 *
 * Why it exists: the artifact the admission gate reads was written by a SPEC
 * (evolution-core/tests/health-baseline.spec.ts guarded by a write flag on that spec) - a test producing
 * a gate's input, which means the gate's evidence depended on somebody remembering to run the
 * right spec with the right env var. The layering rule of this group: whoever WRITES an artifact
 * is a producer named gen-*, whoever READS it is a gate, and the reader declares its producer
 * (the checks fact's requires entry) so a missing product is cannot-decide, never a silent pass.
 *
 * The numbers are computed by the engine (evolution-core/src/health-baseline.ts) through Node's
 * type stripping - the same implementation the spec asserts on, so the artifact cannot drift from
 * the engine. This script only reads the corpora and writes the bytes.
 *
 * Usage: node <scripts-dir>/gen-health-baseline.mjs [--out <path>]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { collectCorpusSkills } from './lib-health-corpus.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TREE = resolve(HERE, '..')
const argv = process.argv.slice(2)
const outFlag = argv.indexOf('--out')
const out = outFlag >= 0 && argv[outFlag + 1] !== undefined ? resolve(argv[outFlag + 1]) : join(HERE, 'reports', 'health-baseline.json')

const { roots, skills } = collectCorpusSkills()
const enginePath = join(TREE, 'evolution-core', 'src', 'health-baseline.ts')
let engine
try {
  engine = await import(pathToFileURL(enginePath).href)
} catch (error) {
  console.error('gen-health-baseline: CANNOT DECIDE - the engine at ' + enginePath + ' could not be loaded (' + (error instanceof Error ? error.message : String(error)) + ')')
  process.exit(2)
}
if (typeof engine.buildHealthBaseline !== 'function') {
  console.error('gen-health-baseline: CANNOT DECIDE - ' + enginePath + ' exports no buildHealthBaseline (the calibration has no single implementation)')
  process.exit(2)
}
const baseline = engine.buildHealthBaseline(skills)
const text = JSON.stringify(baseline, null, 2) + '\n'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, text)
const face = HERE.split(/[\\/]/).includes('evolution') ? 'overlay' : 'mirror'
console.log('gen-health-baseline: face=' + face + ' tree=' + TREE + ' corpora=user:' + String(baseline.corpora.user) + '/platform:' + String(baseline.corpora.platform) + ' rules=' + String(Object.keys(baseline.values).length) + ' root(s)=' + roots.map((entry) => entry.corpus + ':' + entry.root).join(',') + ' -> wrote ' + out + ' (' + text.length + ' bytes)')
