import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const home = args.get('--home')
const out = args.get('--out')
if (!home || !out) { console.error('usage: node scripts/merge-source-snapshot.mjs --home <home> --out <json>'); process.exit(2) }
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const state = existsSync(join(home, 'merge', 'merge-state.json')) ? read(join(home, 'merge', 'merge-state.json')) : null
const rows = state?.rows ?? []
const counts = { verify: 0, pending: 0, approved: 0, fuse: 0, skipped: 0, unknown: 0 }
const pairs = []
for (const row of rows) {
  const key = Object.prototype.hasOwnProperty.call(counts, row.state) ? row.state : 'unknown'
  counts[key] += 1
  pairs.push({ key: row.pairKey, queue: row.queue ?? null, state: row.state, decision: row.decision === undefined ? null : { shouldMerge: row.decision.shouldMerge, mode: row.decision.mode, target: row.decision.target, sources: row.decision.sources }, target: row.decision?.target ?? null, sources: row.decision?.sources ?? null, archiveReason: row.archiveReason ?? null, receiptId: row.receiptId ?? null, stagingRef: row.stagingRef ?? null, runId: row.runId ?? null, unitId: row.unitId ?? null })
}
const receipts = existsSync(join(home, 'merge', 'receipts')) ? readdirSync(join(home, 'merge', 'receipts')) : []
const journals = existsSync(join(home, 'merge', 'journals')) ? readdirSync(join(home, 'merge', 'journals')).map(name => ({ name, phase: read(join(home, 'merge', 'journals', name))?.phase ?? 'unknown' })) : []
const staging = existsSync(join(home, 'merge', 'runs')) ? readdirSync(join(home, 'merge', 'runs')) : []
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), source: { receipts, journals, staging }, counts, pairs, blockers: [], quarantine: [] }
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log('SOURCE SNAPSHOT rows=' + rows.length + ' receipts=' + receipts.length + ' journals=' + journals.length + ' staging=' + staging.length)