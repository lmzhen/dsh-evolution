#!/usr/bin/env node
/**
 * gen-gate-manifest — 由两份事实源生成仓内门禁清单（G0-1）。
 * 源 1：CONTRIBUTING.md 的门禁表（编号 | Command | Working tree）
 * 源 2：.github/actions/evolution-validate/action.yml 的 run 步骤（CI 实际执行集）
 * 规则：种子 = 表 ∪ CI；CI 独有者补登记（profiles:[ci] + reason + expiry）；
 *       external（表第三列 machine-local / 命令指向 D:/dsh/ 仓外）必带 reason + expiry。
 * 用法：node packages/scripts/gen-gate-manifest.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const OUT = join(HERE, 'gate-manifest.json')
const check = process.argv.includes('--check')

const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// --- 源 1：门禁表 ---
const tableSrc = read('CONTRIBUTING.md').split(/\r?\n/)
const rowRe = /^\|\s*(\d+)\s*\|(.+?)\|\s*([^|]+?)\s*\|\s*$/
const gates = []
for (const line of tableSrc) {
  const m = rowRe.exec(line)
  if (!m) continue
  const n = Number(m[1])
  const cell = m[2]
  const treeRaw = m[3].trim()
  const cmdMatch = /`([^`]+)`/.exec(cell)
  if (!cmdMatch) continue
  const cmd = cmdMatch[1].trim()
  const tree = /machine-local/i.test(treeRaw) ? 'machine-local' : (/overlay/i.test(treeRaw) ? 'overlay' : 'mirror')
  const external = tree === 'machine-local' || /D:\/dsh\/audit-|mirror-sync\.mjs/.test(cmd)
  const steplike = /(^|\/)(build-lib|prepare-release|publish-scoped|install-layered|inject-evolution-paths|run-load-sensitive|lib-[\w.-]+)\.mjs/.test(cmd)
  const toolchain = /node_modules\/(typescript|oxlint|vitest)/.test(cmd)
  const kind = external ? 'external' : toolchain ? 'toolchain' : steplike ? 'step' : 'script'
  const entry = { id: 'gate-' + String(n).padStart(2, '0'), kind, cmd, tree, profiles: [] }
  if (kind === 'step') {
    entry.reason = 'mutating/helper step — registered, not run by run-gates (contract 5c)'
  }
  if (kind === 'external') {
    entry.reason = 'machine-local command outside this repo (table row ' + n + ')'
    entry.expiry = '0.26.0'
  }
  gates.push(entry)
}

// --- 源 2：CI 实际执行集 ---
const action = read('.github/actions/evolution-validate/action.yml')
const ciScripts = new Set()
for (const m of action.matchAll(/node\s+(?:packages\/scripts|packages\/evolution\/scripts)\/([\w.-]+\.mjs)/g)) ciScripts.add(m[1])
const ciToolchain = new Set([
  ...(/typescript\/lib\/tsc\.js/.test(action) ? ['tsc'] : []),
  ...(/oxlint\/bin\/oxlint/.test(action) ? ['oxlint'] : []),
  ...(/vitest\/vitest\.mjs/.test(action) ? ['vitest'] : []),
])
const scriptName = (cmd) => (/([\w.-]+\.mjs)/.exec(cmd) || [])[1] || ''
const toolName = (cmd) => (/typescript\/lib\/tsc\.js/.test(cmd) ? 'tsc' : /oxlint\/bin\/oxlint/.test(cmd) ? 'oxlint' : /vitest\/vitest\.mjs/.test(cmd) ? 'vitest' : '')

for (const g of gates) {
  if (g.kind === 'external' || g.kind === 'step') continue
  const inCi = g.kind === 'toolchain' ? ciToolchain.has(toolName(g.cmd)) : ciScripts.has(scriptName(g.cmd))
  g.profiles = inCi ? ['local', 'ci'] : ['local']
}

const known = new Set(gates.map((g) => scriptName(g.cmd)).filter(Boolean))
const ciOnly = [...ciScripts].filter((n) => !known.has(n)).sort()
// CI 独有项：命令取 action.yml 的**原样**调用行（不许自造参数）
// 折叠 YAML 续行（行尾反斜杠）后再取命令，否则丢失续行参数（G0-2 验收 R5 实测）
const rawLines = action.split(/\r?\n/).map((l) => l.trim())
const folded = []
for (let i = 0; i < rawLines.length; i += 1) {
  let cur = rawLines[i]
  while (/\\$/.test(cur) && i + 1 < rawLines.length) { i += 1; cur = cur.replace(/\\$/, '') + ' ' + rawLines[i] }
  folded.push(cur)
}
const ciLines = folded.filter((l) => /\.mjs|node_modules\//.test(l) && !l.startsWith('#'))
const ciCmdFor = (name) => {
  const hit = ciLines.find((l) => l.includes(name))
  if (!hit) return null
  const cleaned = hit.replace(/\\$/, '').replace(/\s+/g, ' ').trim()
  const idx = cleaned.indexOf('node ')
  return idx >= 0 ? cleaned.slice(idx) : cleaned
}
for (const [i, name] of ciOnly.entries()) {
  const isGate = /^(verify|audit|gen)-/.test(name)
  const verbatim = ciCmdFor(name)
  gates.push({
    id: 'ci-only-' + String(i + 1).padStart(2, '0'),
    kind: isGate ? 'script' : 'step',
    cmd: verbatim || 'node packages/scripts/' + name,
    tree: /packages\/evolution\/scripts/.test(verbatim || '') ? 'overlay' : 'mirror',
    profiles: isGate ? ['ci'] : [],
    reason: isGate ? 'CI-only gate with no table row yet — local slot pending (G0-1)' : 'mutating/helper step — registered, not run by run-gates (contract 5c)',
    expiry: '0.26.0',
  })
}

// localSafe：命令含逃出仓根的相对路径 ⇒ 只在 CI 成立（契约 §5d）
for (const g of gates) {
  if (g.kind === 'external' || g.kind === 'step') continue
  if (g.cmd.includes('../')) { g.localSafe = false; g.localSafeReason = 'CI workspace-relative path — not resolvable on a dev machine' }
}

// G0-3: the arming gate can drill its own criterion source (contract §5d)
for (const g of gates) if (g.cmd.includes('verify-arming.mjs')) g.drillCmd = 'node packages/scripts/verify-arming.mjs --drill'

// P0-prime: the graph-edges gate can drill its own criterion source (contract §5d)
for (const g of gates) if (g.cmd.includes('verify-graph-edges.mjs')) g.drillCmd = 'node packages/scripts/verify-graph-edges.mjs --self-test'

// G0-4（契约 §5e）：同一脚本两条 —— CI 只有 policy 形体（CI 无床），真比对进 local/pre-tag。
gates.push(
  { id: 'line-identity-ci', kind: 'script', tree: 'mirror', profiles: ['ci'], cmd: 'node packages/scripts/verify-line-identity.mjs --policy-only --strict', reason: 'CI has no machine bed — policy half only (contract §5e)' },
  { id: 'line-identity-bed', kind: 'script', tree: 'mirror', profiles: ['local', 'pre-tag'], cmd: 'node packages/scripts/verify-line-identity.mjs --manifest packages/scripts/files/line-manifest.json --strict', reason: 'toothed form: compares the bed manifest produced by gen-line-manifest.mjs' },
)

// P0-prime（R99）：活根形是第二条 —— 需要依赖可解析的树 + 技能根；裸 mirror 预期 exit 2 / reader-unavailable。
gates.push({
  id: 'graph-edges-live',
  kind: 'script',
  tree: 'overlay',
  profiles: ['local', 'pre-tag'],
  cmd: 'node packages/evolution/scripts/verify-graph-edges.mjs --report',
  noDrillReason: 'live-root form: it reads the user skill roots; a drill needs a repo-internal fixture root (--roots), which does not exist yet — the self-test form (gate-46) is the falsifiable half',
  reason: 'live-root form: needs a resolvable dependency tree and skill roots; the bare mirror is expected to exit 2 with reason=reader-unavailable (R99/R145)',
  expiry: '0.26.0',
})
// G0-5：tsc 行是**声明在本地跑**的检查 —— CI 注释（action.yml L168-171）写明 D-9 测试文件类型检查已随
// baseline job 移除、`tsc -b tsconfig.host.json` 落在 **build line** 上 ⇒ 给该条目补 reason+expiry，
// 让 verify-gate-manifest 的 toolchain containment 能把它认作**已登记例外**（而不是当成漏跑）。
for (const g of gates) {
  if (g.cmd.includes('typescript/lib/tsc.js') && g.reason === undefined) {
    g.reason = 'declared local check: the D-9 test-file typecheck lives on the build line, not in this action (action.yml L168-171)'
    g.expiry = '0.26.0'
  }
}

// G1 收口：准入门禁只在有语料的机器上有意义（CI 无用户库/平台语料 ⇒ 会报 CANNOT DECIDE）
gates.push({
  id: 'health-admission',
  kind: 'script',
  tree: 'mirror',
  profiles: ['local', 'pre-tag'],
  cmd: 'node packages/scripts/verify-health-admission.mjs',
  reason: 'needs both local corpora; on a machine without them it must report CANNOT DECIDE rather than pass',
})

const out = {
  version: 1,
  generatedBy: 'packages/scripts/gen-gate-manifest.mjs',
  sources: ['CONTRIBUTING.md (gate table)', '.github/actions/evolution-validate/action.yml (CI run steps)'],
  gates,
}
const text = JSON.stringify(out, null, 2) + '\n'

if (check) {
  const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (old !== text) { console.error('gen-gate-manifest --check: gate-manifest.json is stale — rerun without --check'); process.exit(1) }
  console.log('gen-gate-manifest --check: OK (' + gates.length + ' gates)')
  process.exit(0)
}
// P0-prime（迁移角）：不可证伪必须显式声明。**今天只报不拦** —— 既存 script 条目里有多条
// 既无 drillCmd 也无 noDrillReason（实测点名的第一条是 gate-05），直接开断言会把生成器变红。
// 迁移任务：列清单 → 逐条补 drillCmd 或 noDrillReason → 再把下面这段改成 process.exit(1)。
const undeclared = gates.filter((gate) => gate.kind === 'script' && gate.drillCmd === undefined && gate.noDrillReason === undefined)
if (undeclared.length > 0) console.error('gen-gate-manifest: 提示 —— ' + undeclared.length + ' 条 script 未声明可否 drill（迁移中，暂不拦）：' + undeclared.slice(0, 6).map((gate) => gate.id).join(', ') + (undeclared.length > 6 ? ' …' : ''))
writeFileSync(OUT, text)
const counts = gates.reduce((a, g) => (a[g.kind] = (a[g.kind] || 0) + 1, a), {})
console.log('gen-gate-manifest: wrote ' + gates.length + ' gates ' + JSON.stringify(counts) + ' (ci-only: ' + ciOnly.length + ')')
