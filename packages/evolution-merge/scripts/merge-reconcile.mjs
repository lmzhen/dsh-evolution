import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const sourcePath = args.get('--source')
const targetPath = args.get('--target')
const out = args.get('--out')
if (!sourcePath || !targetPath || !out) { console.error('usage: node scripts/merge-reconcile.mjs --source <json> --target <json> --out <json>'); process.exit(2) }
const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
const target = JSON.parse(readFileSync(targetPath, 'utf8'))
const diffs = []
for (const key of new Set([...Object.keys(source.counts ?? {}), ...Object.keys(target.counts ?? {})])) {
  if ((source.counts?.[key] ?? 0) !== (target.counts?.[key] ?? 0)) diffs.push({ key: 'counts.' + key, source: source.counts?.[key] ?? 0, target: target.counts?.[key] ?? 0 })
}
for (const field of ['receipts', 'journals', 'staging']) {
  const av = JSON.stringify(source.source?.[field] ?? null)
  const bv = JSON.stringify(target.source?.[field] ?? null)
  if (av !== bv) diffs.push({ key: 'source.' + field, source: av, target: bv })
}
for (const field of ['blockers', 'quarantine']) {
  const av = JSON.stringify(source[field] ?? null)
  const bv = JSON.stringify(target[field] ?? null)
  if (av !== bv) diffs.push({ key: field, source: av, target: bv })
}
const sourcePairs = new Map((source.pairs ?? []).map(pair => [pair.key, pair]))
const targetPairs = new Map((target.pairs ?? []).map(pair => [pair.key, pair]))
for (const key of new Set([...sourcePairs.keys(), ...targetPairs.keys()])) {
  const a = sourcePairs.get(key)
  const b = targetPairs.get(key)
  if (!a || !b) { diffs.push({ key, field: 'presence', source: Boolean(a), target: Boolean(b) }); continue }
  for (const field of ['queue', 'state', 'decision', 'target', 'sources', 'archiveReason', 'receiptId', 'stagingRef', 'runId', 'unitId']) {
    const av = JSON.stringify(a[field] ?? null)
    const bv = JSON.stringify(b[field] ?? null)
    if (av !== bv) diffs.push({ key, field, source: av, target: bv })
  }
}
const report = { schemaVersion: 1, ok: diffs.length === 0, diffs, quarantined: target.quarantine ?? [], generatedAt: new Date().toISOString() }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log((report.ok ? 'RECONCILE OK' : 'RECONCILE FAIL') + ' diffs=' + diffs.length + ' quarantine=' + report.quarantined.length)
process.exit(report.ok ? 0 : 1)
