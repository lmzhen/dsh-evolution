#!/usr/bin/env node
/**
 * gen-line-manifest — 机器床清单的唯一仓内产出器（G0-4）。
 * 契约 §5e：产出器入仓；真比对进 local/pre-tag；CI 保持 policy-only。
 * 形状与 lib-line-header.mjs 的消费者**同源**：{ pin, bed: { mono }, entries: [{ id, kind, resolvedPath }] }，
 * 并用 readLineHeader/formatLineHeader 自检（禁止第二套概念）。
 * 用法：node packages/scripts/gen-line-manifest.mjs [--overlay <dir>] [--pin <id>] [--out <path>] [--check]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatLineHeader, readLineHeader } from './lib-line-header.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const policy = JSON.parse(readFileSync(join(HERE, 'line-policy.json'), 'utf8'))
const overlay = resolve(flag('--overlay') ?? process.env.EVOLUTION_OVERLAY_ROOT ?? 'D:/dsh/deepseek-harness')
const profile = resolve(flag('--profile') ?? process.env.EVOLUTION_PROFILE ?? 'D:/dsh-homes/web/profiles/web')
const pin = flag('--pin') ?? 'unknown'
const out = resolve(flag('--out') ?? join(HERE, 'files', 'line-manifest.json'))
const check = args.includes('--check')

// 家族包：以 overlay 的 workspace 目录为**解析结果**（开发态就是从这里解析的），kind = evo-src（政策允许的家族线路）。
const overlayPkgs = join(overlay, 'packages', 'evolution')
const familyPairs = readdirSync(join(ROOT, 'packages'))
  .sort()
  .map((n) => ({ dir: n, pkg: join(ROOT, 'packages', n, 'package.json') }))
  .filter((p) => existsSync(p.pkg))
  .map((p) => ({ dir: p.dir, id: JSON.parse(readFileSync(p.pkg, 'utf8')).name }))
  .filter((p) => typeof p.id === 'string' && p.id.startsWith('@deepseek-ai/dsh-evolution-'))
  .sort((a, b) => (a.id < b.id ? -1 : 1))
const entries = []
for (const { dir: shortDir, id } of familyPairs) {
  const dir = join(overlayPkgs, shortDir)
  if (existsSync(dir)) entries.push({ id, kind: 'evo-src', resolvedPath: dir })
  else entries.push({ id, kind: 'unresolved', resolvedPath: '' })
}
// profile hoist：政策声明过的机器态包，从 profile 的 node_modules 记实。
const hoists = Object.keys(policy.profileHoist ?? {}).sort()
for (const id of hoists) {
  const dir = join(profile, 'node_modules', ...id.split('/'))
  if (existsSync(dir)) entries.push({ id, kind: 'profile-hoist', resolvedPath: dir })
}

const manifest = { pin, bed: { mono: overlay }, entries }
const text = JSON.stringify(manifest, null, 2) + '\n'
if (check) {
  const old = existsSync(out) ? readFileSync(out, 'utf8') : ''
  if (old !== text) { console.error('gen-line-manifest --check: ' + out + ' is stale — rerun without --check'); process.exit(1) }
  console.log('gen-line-manifest --check: OK (' + entries.length + ' entries)')
  process.exit(0)
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, text)
// 自检：必须能被权威模块读出表头（同源证明）
const header = readLineHeader(out)
const kinds = entries.reduce((a, e) => (a[e.kind] = (a[e.kind] || 0) + 1, a), {})
console.log('gen-line-manifest: wrote ' + entries.length + ' entries to ' + out + ' ' + JSON.stringify(kinds))
console.log('  ' + formatLineHeader(header))
