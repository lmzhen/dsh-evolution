#!/usr/bin/env node
/*
 * verify-health-admission — 规则准入的判断方（G1，契约 §4）。
 * 只读产物＋判定：命中率由引擎侧算（health-baseline.ts），门禁绝不重算。
 * 平台语料或用户语料为空 ⇒ 报 CANNOT DECIDE（空集上的 0 命中是空洞成立）。
 * 只有 policy 里 inForce 的规则会因准入失败报红，其余只报告。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const baselinePath = resolve(arg('--baseline', join(HERE, 'reports', 'health-baseline.json')))
const policyPath = resolve(arg('--policy', join(HERE, 'health-admission-policy.json')))

if (existsSync(baselinePath) === false) {
  console.error('verify-health-admission: no baseline at ' + baselinePath)
  console.error('  produce it with WRITE_HEALTH_BASELINE=1 on the evolution-core health-baseline spec')
  process.exit(1)
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const policy = existsSync(policyPath) ? JSON.parse(readFileSync(policyPath, 'utf8')) : { inForce: [] }
const inForce = Array.isArray(policy.inForce) ? policy.inForce : []

if (baseline.unit !== 'chars' || baseline.scope !== 'references markdown file count') {
  console.error('verify-health-admission: unit/scope drifted from the frozen wording')
  process.exit(1)
}
const user = Number((baseline.corpora ?? {}).user ?? 0)
const platform = Number((baseline.corpora ?? {}).platform ?? 0)
if (user === 0 || platform === 0) {
  console.error('verify-health-admission: CANNOT DECIDE — corpora user=' + String(user) + ' platform=' + String(platform))
  console.error('  a 0-hit count over an empty corpus admits every rule; supply both corpora first')
  process.exit(2)
}

const rows = baseline.values ?? {}
const problems = []
console.log('verify-health-admission: corpora user=' + String(user) + ' platform=' + String(platform) + ' rows=' + String(Object.keys(rows).length) + ' inForce=' + String(inForce.length))
for (const id of Object.keys(rows)) {
  const row = rows[id]
  const hits = Number(row.platformHits ?? 0)
  const rate = Number(row.userHitRate ?? 0)
  const forceful = inForce.includes(id)
  let bad = ''
  if (hits !== 0) bad = 'platform hits ' + String(hits)
  else if (rate < 0.05) bad = 'user rate ' + rate.toFixed(3) + ' below 0.05'
  else if (rate > 0.25) bad = 'user rate ' + rate.toFixed(3) + ' above 0.25'
  console.log('  ' + (forceful ? '[in force] ' : '[report]   ') + id + (bad === '' ? ' admitted' : ' — ' + bad))
  if (forceful && bad !== '') problems.push(id + ': ' + bad)
}
for (const id of inForce) if (rows[id] === undefined) problems.push(id + ' is declared in force but has no baseline row')
if (problems.length > 0) {
  console.error('verify-health-admission: ' + String(problems.length) + ' in-force rule(s) failed admission')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('verify-health-admission: OK' + (inForce.length === 0 ? ' (no rule is in force yet — reporting only)' : ''))
