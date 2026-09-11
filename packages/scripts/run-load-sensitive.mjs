#!/usr/bin/env node
/**
 * G7.2 load-sensitive lock group: run the io.spec contention cases ONCE, at a
 * fixed worker count, and assert the result — instead of letting them pass (or
 * fail) by accident of whatever parallelism the default run happened to use.
 *
 * Why these cases: every one of them decides by a LOCK TIMING OR LIVENESS
 * threshold (takeover deadlines, a same-pid long-running holder, 32-way
 * contention on one dead lock). Under a loaded machine the timing thresholds and
 * the OS scheduler interact, so a green default run proves less than a green
 * run at a known concurrency — and a red one tells you nothing about the code.
 * The list carries the reason per case so the group cannot be widened silently.
 *
 * The group is asserted NON-EMPTY: a renamed test drops out of the `-t` pattern,
 * and the count check then fails instead of reporting a vacuous pass. (The
 * V27-era names are the contract here; renaming a case means updating its entry.)
 *
 * Usage (works from BOTH layouts — dev `packages/evolution/scripts/…`, flat
 * mirror `packages/scripts/…`; run with the repository root as cwd or as the
 * first argument, because the runner drives the repo's own vitest):
 *   node <scripts-dir>/run-load-sensitive.mjs [repo-root]
 *
 * Environment:
 *   DSH_EVOLUTION_LOAD_SENSITIVE_WORKERS  worker count to pin (default 4)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? process.cwd())
const spec = 'packages/evolution/evolution-core/tests/io.spec.ts'
const workers = process.env.DSH_EVOLUTION_LOAD_SENSITIVE_WORKERS ?? '4'

/**
 * The load-sensitive group. Each entry names the case and WHY it is in the
 * group; the `-t` pattern below is the union of these names.
 */
const LOAD_SENSITIVE = [
  { name: 'serializes concurrent writers', why: 'two writers contend for one lock' },
  { name: 'takes over a stale lock', why: 'takeover deadline vs. wall clock' },
  { name: 'never steals a lock from a LIVE holder', why: 'liveness deadline (the case that regressed in rc.66)' },
  { name: 'takes over a stale lock from a GONE pid', why: 'pid-liveness probe under load' },
  { name: 'transact runs read-modify-write atomically under one lock', why: 'cross-process RMW ordering' },
  { name: 'two peers take over one stale dead lock', why: 'F-101 double-hold window' },
  { name: 'self-heals a leftover lock carrying this process pid', why: 'same-pid takeover' },
  { name: 'never removes a NEW same-pid lock', why: 'same-pid cleanup race' },
  { name: 'does not steal a same-pid lock held by a long-running task', why: 'the V4-05 double-hold case' },
  { name: 'takeover claims a stale dead lock atomically', why: 'atomic ticket claim (V4-04)' },
  { name: 'ticket takeover survives 32-way contention', why: 'the high-contention case (V4-04 follow-up)' },
  { name: 'EMPTY stale lock is taken over', why: 'the empty-body takeover branch (G0.2)' },
  { name: 'self-heals a 0-byte lock', why: 'crash residue takeover (V6-04)' },
  { name: 'reclaims a 0-byte takeover ticket', why: 'crash residue takeover (V6-04)' },
  { name: 'sweeps a stale `.lock.next` ticket', why: 'ticket sweep vs. liveness (V6-18)' },
  { name: 'keeps a fresh live-pid ticket', why: 'ticket sweep must spare a live holder (V6-18)' },
  { name: 'committed-but-unfsynced write is success-with-warning', why: 'commit-point ownership under a lost lock (G1.3)' },
]

const pattern = LOAD_SENSITIVE.map(entry => entry.name).join('|')

const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
if (!existsSync(vitest)) {
  console.error(`run-load-sensitive: no vitest at ${vitest} — pass the repository root (vacant guard: a missing runner is not a pass)`)
  process.exit(2)
}
if (!existsSync(join(root, spec))) {
  console.error(`run-load-sensitive: no ${spec} under ${root} — pass the repository root`)
  process.exit(2)
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-load-sensitive-'))
const report = join(scratch, 'report.json')
console.log(`run-load-sensitive: ${LOAD_SENSITIVE.length} case(s), ${workers} worker(s) pinned, one run`)
for (const entry of LOAD_SENSITIVE) console.log(`  - ${entry.name}  (${entry.why})`)

const run = spawnSync(process.execPath, [
  vitest, 'run', spec,
  '-t', pattern,
  `--maxWorkers=${workers}`,
  '--retry=0',
  '--reporter=default',
  '--reporter=json',
  `--outputFile=${report}`,
], { cwd: root, stdio: 'inherit' })

let summary
try {
  const parsed = JSON.parse(readFileSync(report, 'utf8'))
  summary = {
    total: parsed.numTotalTests ?? 0,
    passed: parsed.numPassedTests ?? 0,
    failed: parsed.numFailedTests ?? 0,
  }
} catch (error) {
  rmSync(scratch, { recursive: true, force: true })
  console.error(`run-load-sensitive: could not read the vitest report (${error instanceof Error ? error.message : String(error)}) — the run proves nothing`)
  process.exit(2)
}
rmSync(scratch, { recursive: true, force: true })

// `numTotalTests` counts EVERY test in the file (the `-t` filter leaves the rest
// skipped), so the group size is the number of tests that actually RAN.
const matched = summary.passed + summary.failed
if (matched < LOAD_SENSITIVE.length) {
  console.error(
    `run-load-sensitive: only ${matched} of the ${LOAD_SENSITIVE.length} declared case(s) ran — `
    + 'a renamed case is not being run at fixed concurrency; update its entry in LOAD_SENSITIVE.',
  )
  process.exit(1)
}
if (summary.failed > 0 || run.status !== 0) {
  console.error(`run-load-sensitive: ${summary.failed} failure(s) in the load-sensitive group at ${workers} worker(s) — see the vitest output above (takeover diagnostics are printed by the io layer)`)
  process.exit(1)
}
console.log(`run-load-sensitive: OK — ${summary.passed}/${LOAD_SENSITIVE.length} declared load-sensitive case(s) passed at a pinned ${workers} worker(s)`)
