#!/usr/bin/env node
/**
 * gen-line-manifest — 机器床清单的唯一仓内产出器（G0-4）。
 * 契约 §5e：产出器入仓；真比对进 local/pre-tag；CI 保持 policy-only。
 * 形状与 lib-line-header.mjs 的消费者**同源**：{ pin, bed: { mono }, entries: [{ id, kind, resolvedPath }] }，
 * 并用 readLineHeader/formatLineHeader 自检（禁止第二套概念）。
 * 用法：node packages/scripts/gen-line-manifest.mjs [--overlay <dir>] [--pin <id>] [--out <path>] [--check]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatLineHeader, readLineHeader } from './lib-line-header.mjs'
import { REPO_ROOT, requireOverlay, requireProfile } from './lib-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = REPO_ROOT
const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const policy = JSON.parse(readFileSync(join(HERE, 'line-policy.json'), 'utf8'))
const overlay = resolve(flag('--overlay') ?? requireOverlay())
const profile = resolve(flag('--profile') ?? requireProfile())
// P1-② (release review 2026-10-15): a line with no pin is a line nobody can name, and the family rule
// (lib-line-header) is explicit: a green result may not be claimed when the line is unknown. Take the
// real short SHA - the same source formatCiLineHeader uses in CI - and keep `unknown` as the fallback
// for a tree that is not a git checkout at all (it stays loud: verify-line-identity refuses on it).
const pin = flag('--pin') ?? (() => { try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch (error) { console.error('[pin-probe] ' + (error instanceof Error ? error.message : String(error))); return 'unknown' } })()
const out = resolve(flag('--out') ?? join(HERE, 'files', 'line-manifest.json'))
const check = args.includes('--check')

// 家族包：以 overlay 的 workspace 目录为**解析结果**（开发态就是从这里解析的），kind = evo-src（政策允许的家族线路）。
const overlayPkgs = join(overlay, 'packages', 'evolution')
const familyPairs = readdirSync(join(ROOT, 'packages'))
  .sort()
  .map((n) => ({ dir: n, pkg: join(ROOT, 'packages', n, 'package.json') }))
  .filter((p) => existsSync(p.pkg))
  .map((p) => ({ dir: p.dir, id: JSON.parse(readFileSync(p.pkg, 'utf8')).name }))
  .filter((p) => typeof p.id === 'string' && (p.id.startsWith('@deepseek-ai/dsh-evolution-') || p.id === '@lmzhen/dsh-evolution-client-kit'))
  .sort((a, b) => (a.id < b.id ? -1 : 1))
// F1 (release review 2026-10-15): the artifact must be MACHINE-INDEPENDENT. It used to record the
// resolved ABSOLUTE path and an `unresolved` kind decided by existsSync, so the committed manifest
// embedded 30 host paths and `--check` could only ever pass on the machine that generated it -
// exactly the "green here, red on the runner" shape the CI step was added to prevent. The family
// roster comes from THIS repo, and `kind` is policy (a family line is evo-src by declaration), so
// both are now derived without touching the overlay; existence is a CONSUMER question (local/pre-tag,
// as the header contract puts it: "真比对进 local/pre-tag；CI 保持 policy-only").
const entries = []
for (const { dir: shortDir, id } of familyPairs) {
  entries.push({ id, kind: 'evo-src', relPath: 'packages/evolution/' + shortDir })
}
// profile hoist：政策声明过的机器态包，从 profile 的 node_modules 记实。
const hoists = Object.keys(policy.profileHoist ?? {}).sort()
for (const id of hoists) {
  // A profile hoist IS machine state - that is the point of the kind - so it carries no path at all;
  // the consumer resolves it against the profile it is running on.
  entries.push({ id, kind: 'profile-hoist' })
}

const manifest = { pin, bed: { mono: 'overlay' }, entries }
const text = JSON.stringify(manifest, null, 2) + '\n'
if (check) {
  // P1 (release review round 4, 2026-10-15): the PIN must not be part of the compared face. It is HEAD,
  // so it moves with every commit while the artifact is committed as well - a --check that did not
  // regenerate first would then report a stale artifact nobody touched, i.e. a false regression right
  // after the release commit. Identity is id+kind (lib-line-header hashes exactly those), so the compared
  // face is entries+bed; the pin is asserted separately, because a line nobody can name is not checked.
  const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null
  const sameFace = previous !== null
    && JSON.stringify({ bed: previous.bed, entries: previous.entries })
      === JSON.stringify({ bed: manifest.bed, entries: manifest.entries })
  const pinNamed = typeof previous?.pin === 'string' && previous.pin !== 'unknown'
  if (!sameFace) { console.error('gen-line-manifest --check: ' + out + ' is stale — rerun without --check'); process.exit(1) }
  if (!pinNamed) { console.error('gen-line-manifest --check: ' + out + ' carries no line pin; rerun without --check'); process.exit(2) }
  console.log('gen-line-manifest --check: OK (' + entries.length + ' entries, pin=' + String(previous.pin) + ')')
  process.exit(0)
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, text)
// 自检：必须能被权威模块读出表头（同源证明）
const header = readLineHeader(out)
const kinds = entries.reduce((a, e) => (a[e.kind] = (a[e.kind] || 0) + 1, a), {})
console.log('gen-line-manifest: wrote ' + entries.length + ' entries to ' + out + ' ' + JSON.stringify(kinds))
console.log('  ' + formatLineHeader(header))
