#!/usr/bin/env node
/**
 * run-gates — 门禁清单的唯一执行器（G0-2）。只判不改。
 * 用法：node packages/scripts/run-gates.mjs <local|pre-tag|ci> [--list] [--json] [--only <id>] [--drill <id>] [--overlay <path>]
 * 规则（契约 §5/§5b/§5c）：seed = CI ∪ 表；pre-tag = local ∪ ci；
 *   runner 只跑 kind=script|toolchain；kind=step|external 只登记不执行；
 *   tree=overlay 的门禁在 overlay 根下跑（默认同级目录，--overlay 或 EVOLUTION_OVERLAY_ROOT 覆盖）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIRROR_ROOT = resolve(HERE, '..', '..')
const MANIFEST = join(HERE, 'gate-manifest.json')
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '') : undefined }
const has = (name) => args.includes(name)
const profile = args.find((a) => ['local', 'pre-tag', 'ci'].includes(a))
const overlayRoot = flag('--overlay') || process.env.EVOLUTION_OVERLAY_ROOT || resolve(MIRROR_ROOT, '..', 'deepseek-harness')

if (!existsSync(MANIFEST)) { console.error('run-gates: missing gate-manifest.json — run gen-gate-manifest.mjs'); process.exit(2) }
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const RUNNABLE = new Set(['script', 'toolchain'])
const gates = manifest.gates.filter((g) => RUNNABLE.has(g.kind))
const ofProfile = (p) => gates.filter((g) => g.profiles.includes(p))
const union = (a, b) => { const m = new Map(); for (const g of [...a, ...b]) m.set(g.id, g); return [...m.values()] }
const byProfile = { local: ofProfile('local'), ci: ofProfile('ci') }
byProfile['pre-tag'] = union(byProfile.local, byProfile.ci)

const show = (list) => list.map((g) => g.id.padEnd(9) + g.tree.padEnd(8) + g.cmd)
const emit = (list, label) => {
  if (has('--json')) { console.log(JSON.stringify({ profile: label, count: list.length, ids: list.map((g) => g.id) }, null, 2)); return }
  console.log('run-gates [' + label + '] ' + list.length + ' gate(s)')
  for (const line of show(list)) console.log('  ' + line)
}

if (has('--drill')) {
  const id = flag('--drill')
  const g = manifest.gates.find((x) => x.id === id)
  if (!g) { console.error('run-gates --drill: unknown gate ' + id); process.exit(2) }
  if (!g.drillCmd) { console.error('run-gates --drill ' + id + ': this gate declares no drillCmd — its criterion source cannot yet be falsified (contract §5d)'); process.exit(1) }
  // drillCmd 是命令串（与 gate cmd 同形）：按同一解析方式执行，不能当 JS 求值
  const dParts = g.drillCmd.replace(/^node\s+/, '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  const [dScript, ...dRest] = dParts
  const r = spawnSync(process.execPath, [dScript, ...dRest], { cwd: g.tree === 'overlay' ? overlayRoot : MIRROR_ROOT, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

if (!profile) { console.error('run-gates: usage: run-gates.mjs <local|pre-tag|ci> [--list] [--json] [--only <id>] [--drill <id>]'); process.exit(2) }
let list = byProfile[profile]
const only = flag('--only')
if (only !== undefined) { list = list.filter((g) => g.id === only); if (list.length === 0) { console.error('run-gates: --only ' + only + ' not in profile ' + profile); process.exit(2) } }
if (has('--list') || has('--json')) { emit(list, profile); process.exit(0) }

console.log('run-gates [' + profile + '] running ' + list.length + ' gate(s); overlay root = ' + overlayRoot)
const skipped = []
const failed = []
for (const g of list) {
  if (g.localSafe === false && !process.env.CI) { skipped.push(g.id + ' (' + (g.localSafeReason || 'CI-shaped command') + ')'); continue }
  if (g.tree === 'overlay' && !existsSync(overlayRoot)) { skipped.push(g.id + ' (overlay root missing: ' + overlayRoot + ')'); continue }
  const cwd = g.tree === 'overlay' ? overlayRoot : MIRROR_ROOT
  const parts = g.cmd.replace(/^node\s+/, '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  const [script, ...rest] = parts
  const started = Date.now()
  const r = spawnSync(process.execPath, [script, ...rest], { cwd, stdio: 'inherit' })
  const ms = Date.now() - started
  if ((r.status ?? 1) === 0) console.log('  ok   ' + g.id + ' (' + ms + 'ms) ' + script)
  else { console.log('  FAIL ' + g.id + ' (exit ' + (r.status ?? '?') + ') ' + script); failed.push(g.id) }
}
console.log('run-gates [' + profile + '] done: ' + (list.length - failed.length - skipped.length) + ' ok, ' + failed.length + ' failed, ' + skipped.length + ' skipped')
if (skipped.length > 0) console.log('  skipped: ' + skipped.join('; '))
process.exit(failed.length > 0 ? 1 : 0)
