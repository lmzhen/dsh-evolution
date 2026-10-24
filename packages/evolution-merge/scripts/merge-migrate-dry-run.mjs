import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const home = args.get('--home')
const out = args.get('--out')
if (!home || !out) { console.error('usage: node scripts/merge-migrate-dry-run.mjs --home <home> --out <file>'); process.exit(2) }
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const blockers = []
const quarantine = []
const counts = { verify: 0, pending: 0, approved: 0, fuse: 0, skipped: 0, unknown: 0 }
const pairs = []
const statePath = join(home, 'merge', 'merge-state.json')
const state = existsSync(statePath) ? readJson(statePath) : null
if (existsSync(statePath) && !state) quarantine.push({ path: 'merge/merge-state.json', reason: 'unreadable-json' })
if (state?.rows) {
  for (const row of state.rows) {
    const key = Object.prototype.hasOwnProperty.call(counts, row.state) ? row.state : 'unknown'
    counts[key] += 1
    if (row.state === 'pending' && !row.decision) blockers.push({ id: row.id, code: 'pending-no-decision' })
    if (row.state === 'fuse' && !row.stagingRef) quarantine.push({ id: row.id, code: 'fuse-no-staging' })
    pairs.push({ key: row.pairKey, queue: row.queue ?? null, state: row.state, decision: row.decision === undefined ? null : { shouldMerge: row.decision.shouldMerge, mode: row.decision.mode, target: row.decision.target, sources: row.decision.sources }, target: row.decision?.target ?? null, sources: row.decision?.sources ?? null, archiveReason: row.archiveReason ?? null, receiptId: row.receiptId ?? null, stagingRef: row.stagingRef ?? null, runId: row.runId ?? null, unitId: row.unitId ?? null })
  }
}
const runsPath = join(home, 'runs.json')
const runs = existsSync(runsPath) ? readJson(runsPath) : null
if (existsSync(runsPath) && !runs) quarantine.push({ path: 'runs.json', reason: 'unreadable-json' })
const receipts = []
const receiptDir = join(home, 'merge', 'receipts')
if (existsSync(receiptDir)) for (const name of readdirSync(receiptDir)) { const value = readJson(join(receiptDir, name)); if (value) receipts.push(name); else quarantine.push({ path: 'merge/receipts/' + name, reason: 'unreadable-json' }) }
const journals = []
const journalDir = join(home, 'merge', 'journals')
if (existsSync(journalDir)) for (const name of readdirSync(journalDir)) { const value = readJson(join(journalDir, name)); if (value) journals.push({ name, phase: value.phase }); else quarantine.push({ path: 'merge/journals/' + name, reason: 'unreadable-json' }) }
const staging = []
const stagingRoot = join(home, 'merge', 'runs')
if (existsSync(stagingRoot)) for (const name of readdirSync(stagingRoot)) staging.push(name)
const report = { schemaVersion: 1, applied: false, generatedAt: new Date().toISOString(), source: { state: statePath, runs: runsPath, receipts, journals, staging }, counts, pairs, blockers, quarantine, wouldMigrate: Object.values(counts).reduce((a, b) => a + b, 0) }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log('DRY RUN OK rows=' + report.wouldMigrate + ' blockers=' + blockers.length + ' quarantine=' + quarantine.length + ' (blockers are reported, not applied)')
process.exit(0)
