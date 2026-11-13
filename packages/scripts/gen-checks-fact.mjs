#!/usr/bin/env node
/**
 * G0 S0.3: the DECLARATION face of the family's checks.
 *
 * Why this exists: the gate table says what RUNS (and CONTRIBUTING.md is its one
 * home), but nothing said what each check ASSERTS, which lane the policy
 * requires it at, or which criterion judges it. That made every check a
 * shape-only step: green meant "the process exited 0", never "the claim holds".
 * This generator derives the rows from the table transcription
 * (scripts/gate-manifest.json, byte-identical in both layouts) and writes the
 * 'checks' fact, which owns exactly the two columns nothing else owns:
 *
 *   tier      - the EARLIEST lane the manifest requires the check at
 *               (local => fast, pre-tag => pre-tag, ci => ci-only)
 *   criterion - the basename of the script the row runs, or the tool for a
 *               toolchain row
 *
 * Only runnable rows (script/toolchain) are checks: step rows are action command
 * text and external rows document another owner's command. The old claim column
 * and its pendingColumns register had no consumer and are deleted (W11 A2).
 *
 * The columns the carrier owns are NOT copied here (that would be the second
 * source this whole round exists to remove); verify-doc-facts re-derives the
 * id set, the criterion-vs-command join and the tier closed set from the carrier
 * on every gate run.
 *
 * Usage: node packages/scripts/gen-checks-fact.mjs [--check]
 *   --check  exit 1 when the asset differs from the derived form (drift gate)
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSET = join(HERE, 'family-facts.json')
// ORDER: the manifest is this generator's INPUT (see the header): regenerate it first with
// gen-gate-manifest.mjs, then re-derive here. A stale derivation is caught, never silent -
// `--check` and verify-doc-facts both go red.
const CARRIER = join(HERE, 'gate-manifest.json')
const CARRIER_REL = 'scripts/gate-manifest.json'
// A declaration is a check, not a documentation slot: only rows the runner can execute have a
// claim/tier/criterion face. Step/external rows are action commands or another owner's command.
const RUNNABLE_KINDS = new Set(['script', 'toolchain'])

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** tier: the earliest lane the manifest requires the check at. */
function tierOf(gate) {
  const profiles = Array.isArray(gate.profiles) ? gate.profiles : []
  if (profiles.includes('local')) return 'fast'
  if (profiles.includes('pre-tag')) return 'pre-tag'
  return 'ci-only'
}

/** criterion: the script/tool the row runs, by basename; a runnable row always names one. */
function criterionOf(gate) {
  // M2: the executable form is argv (human is prose); the criterion is what judges the row.
  const argv = Array.isArray(gate.argv) ? gate.argv : []
  const text = argv.join(' ')
  const match = text.match(/([A-Za-z0-9._-]+)\.(?:mjs|cjs)/)
  if (match !== null) return match[1]
  const tool = argv.find((token, index) => index > 0 && !String(token).startsWith('-'))
  return tool === undefined ? 'unknown' : String(tool).split(/[\\/]/).pop()
}

function buildFact(carrier, asset) {
  const previous = (asset.facts === undefined ? [] : asset.facts).find((fact) => fact && fact.machine && fact.machine.kind === 'checks')
  // the axis register is AUTHORED (each entry is a debt with a measured size, an expiry and an
  // owner) - regeneration must carry it, exactly like a written claim or a requires list.
  const pendingAxes = previous && previous.machine && Array.isArray(previous.machine.pendingAxes) ? previous.machine.pendingAxes : []
  // the mutation records are AUTHORED evidence (G5): regeneration must carry them too
  const checkMutations = previous && previous.machine && previous.machine.checkMutations !== undefined ? previous.machine.checkMutations : {}
  const mutationExempt = previous && previous.machine && previous.machine.mutationExempt !== undefined ? previous.machine.mutationExempt : {}
  // authored too: the rows whose table cell cannot become one command, with owner + plan + expiry
  const cannotDecideRegistered = previous && previous.machine && previous.machine.cannotDecideRegistered !== undefined ? previous.machine.cannotDecideRegistered : {}
  const requiresOf = new Map()
  const rows = previous && previous.machine && Array.isArray(previous.machine.declarations) ? previous.machine.declarations : []
  for (const row of rows) {
    // a prerequisite list is AUTHORED data (nothing else owns it) - regeneration must not drop it
    if (row && Array.isArray(row.requires) && row.requires.length > 0) requiresOf.set(row.id, row.requires)
  }
  const gates = Array.isArray(carrier.gates) ? carrier.gates : []
  const declarations = gates.filter((gate) => RUNNABLE_KINDS.has(gate.kind)).map((gate) => {
    const row = { id: gate.id, tier: tierOf(gate), criterion: criterionOf(gate) }
    if (requiresOf.has(gate.id)) row.requires = requiresOf.get(gate.id)
    return row
  })
  return {
    id: 'checks',
    title: 'the declaration face of every executable check: its tier and its criterion',
    home: 'README.md',
    must: [{ text: 'A check without a declaration is not accounted', unique: true }],
    machine: {
      kind: 'checks',
      file: CARRIER_REL,
      sha256: createHash('sha256').update(readFileSync(CARRIER)).digest('hex'),
      tierSource: 'testing-policy',
      rule: {
        tier: 'the earliest lane the manifest requires the check at: local => fast, pre-tag => pre-tag, ci => ci-only',
        criterion: 'the basename of the script the row runs, or the tool for a toolchain row'
      },
      declarations: declarations,
      pendingAxes: pendingAxes,
      checkMutations: checkMutations,
      mutationExempt: mutationExempt,
      cannotDecideRegistered: cannotDecideRegistered
    }
  }
}

if (!existsSync(CARRIER)) {
  console.log('gen-checks-fact: carrier missing at ' + CARRIER + ' - nothing can be derived')
  process.exit(2)
}
const asset = readJson(ASSET)
// A1b/A2 migration: the claim/pendingColumns/unmapped/unknown register was a self-referential
// column nobody consumed. Delete it deliberately here (the loud-drop guard then sees no loss).
const committedChecks = (asset.facts === undefined ? [] : asset.facts).find((entry) => entry && entry.id === 'checks')
if (committedChecks !== undefined && committedChecks.machine !== undefined) {
  for (const key of ['pendingColumns', 'unmappedTier', 'unknownCriterion', 'duplicateGroups', 'sentinel']) delete committedChecks.machine[key]
  for (const row of Array.isArray(committedChecks.machine.declarations) ? committedChecks.machine.declarations : []) delete row.claim
}
const fact = buildFact(readJson(CARRIER), asset)
const kept = (asset.facts === undefined ? [] : asset.facts).filter((entry) => entry && entry.id !== 'checks')
const next = Object.assign({}, asset, { facts: kept.concat([fact]) })
const text = JSON.stringify(next, null, 2) + '\n'
const check = process.argv.includes('--check')
const here = HERE.split('\\').join('/')
const face = here.includes('/packages/evolution/') ? 'overlay' : 'mirror'
const stamp = 'gen-checks-fact: face=' + face + ' tree=' + here + ' carrier=' + fact.machine.sha256.slice(0, 8) + ' rows=' + fact.machine.declarations.length
if (check) {
  const current = readFileSync(ASSET, 'utf8')
  if (current !== text) {
    console.log(stamp)
    console.log('gen-checks-fact: the checks fact in family-facts.json differs from the derived form - run without --check to refresh it')
    process.exit(1)
  }
  console.log(stamp + ' -> in sync (facts=' + next.facts.length + ')')
  process.exit(0)
}
  // LOUD-DROP GUARD: a hand-written machine key this generator does not carry would vanish
  // silently on the next write. That trap has bitten three times (pendingAxes, checkMutations,
  // mutationExempt), so the write now REFUSES and names the keys: add them to the preserve list
  // in the same commit, or delete them deliberately.
  {
    const committed = (asset.facts === undefined ? [] : asset.facts).find((entry) => entry && entry.machine && entry.machine.kind === 'checks')
    const derived = next.facts.find((entry) => entry && entry.machine && entry.machine.kind === 'checks')
    const missing = committed === undefined ? [] : Object.keys(committed.machine).filter((key) => derived === undefined || !(key in derived.machine))
    if (missing.length > 0) {
      console.error('gen-checks-fact: REFUSING to write - these machine keys exist in the committed fact but the derived form would DROP them: ' + missing.join(', ') + ' (add them to the preserve list, or delete them deliberately)')
      process.exit(1)
    }
  }
writeFileSync(ASSET, text)
console.log(stamp + ' -> wrote ' + ASSET + ' (facts=' + next.facts.length + ')')
