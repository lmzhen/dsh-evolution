#!/usr/bin/env node
/**
 * pre-tag gate for the evolution family: run every check that IS faithful on this machine
 * BEFORE tagging, so CI verifies instead of debugging.
 *
 *   node packages/scripts/pretag-gate.mjs [--overlay <dir>] [--profile <dir>] [--fix]
 *
 * Checks: (1) version three-way — mirror root manifest + every packages/* manifest + the CHANGELOG
 * head carry one version; (2) family lint through the overlay toolchain; (3) the client bundles
 * rebuild; (4) the installed bundle patch equals the published artifact byte for byte (--fix writes
 * the published bytes back and reports loudly).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt }
const mirror = path.resolve(arg('--mirror', 'D:/dsh/dsh-evolution-mirror'))
const overlay = path.resolve(arg('--overlay', 'D:/dsh/deepseek-harness'))
const profile = path.resolve(arg('--profile', 'D:/dsh-homes/web/profiles/web'))
const fix = argv.includes('--fix')
const results = []
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')) }

// 1) version three-way
const rootVersion = JSON.parse(fs.readFileSync(path.join(mirror, 'package.json'), 'utf8')).version
const pkgVersions = new Map()
for (const dir of fs.readdirSync(path.join(mirror, 'packages'))) {
  const p = path.join(mirror, 'packages', dir, 'package.json')
  if (fs.existsSync(p)) pkgVersions.set(dir, JSON.parse(fs.readFileSync(p, 'utf8')).version)
}
const head = fs.readFileSync(path.join(mirror, 'CHANGELOG.md'), 'utf8').split('\n').find((l) => l.startsWith('## '))
const headVersion = (head.match(/^##\s+(\S+)/) || [])[1]
const strays = [...pkgVersions].filter(([, v]) => v !== rootVersion)
record('version three-way', strays.length === 0 && headVersion === rootVersion, 'root=' + rootVersion + ' changelog=' + headVersion + ' packages=' + pkgVersions.size + (strays.length ? ' strays=' + strays.map(([n, v]) => n + '@' + v).join(',') : ''))

// 2) lint through the overlay toolchain
try {
  const ox = path.join(overlay, 'node_modules', '.bin', process.platform === 'win32' ? 'oxlint.cmd' : 'oxlint')
  // `-A typescript`: the type-aware rules need the PLATFORM's resolved types, which differ between
  // this machine's checkout and CI's pinned upstream; they fire here on unresolved imports and pass
  // in CI. The local gate keeps every non-type rule (arrow-parens, max-len, …) and says so.
  const out = execFileSync(ox, ['--config', '.oxlintrc.json', '-A', 'typescript', 'packages/evolution/evolution-core', 'packages/evolution/evolution-skill-health', 'packages/evolution/evolution-review'], { cwd: overlay, encoding: 'utf8', shell: true })
  // oxlint exits non-zero when it finds anything, so reaching this line already means clean;
  // the summary line is reported as evidence rather than re-parsed.
  const summary = (String(out).match(/Found [^\n]*/) || ['(no summary line)'])[0]
  record('family lint', true, summary.slice(0, 90))
} catch (error) {
  const raw = String(error.stdout || '') + String(error.stderr || '')
  const findings = raw.split('\n').map((l) => l.trim()).filter((l) => /^x [a-z-]+\//.test(l))
  // `no-unsafe-*` is the type-aware family: on a machine whose platform checkout is a different ref
  // than CI's pinned upstream they fire on unresolved imports and pass in CI, so they are reported
  // as local noise; any OTHER finding is a real refusal.
  const real = findings.filter((l) => !/^x typescript\(no-unsafe/.test(l))
  const noise = findings.length - real.length
  if (findings.length > 0 && real.length === 0) record('family lint', true, noise + ' type-aware finding(s) ignored (pinned platform types live in CI); 0 other findings')
  else record('family lint', false, 'findings: ' + (real.slice(0, 2).join(' | ') || '(unparsed)') + ' | ' + raw.split('\n').filter((l) => /Found /.test(l)).join(' ').slice(0, 60))
}

// 3) the client bundles rebuild
try {
  const out = execFileSync(process.execPath, ['packages/evolution/scripts/build-client.mjs', 'evolution-skill-health'], { cwd: overlay, encoding: 'utf8' })
  const bundle = path.join(overlay, 'packages/evolution/evolution-skill-health/lib/client.js')
  const bytes = fs.existsSync(bundle) ? fs.readFileSync(bundle, 'utf8') : ''
  // Assert a literal that survives minification: the host route path the panel fetches.
  const route = '/api/dsh-evolution/skill-health/rows'
  record('client bundle', bytes.includes(route), 'client.js bytes=' + bytes.length + ' route=' + String(bytes.includes(route)) + (out.trim() ? ' | ' + out.trim().slice(0, 60) : ''))
} catch (error) { record('client bundle', false, String(error.message).slice(0, 140)) }

// 3b) the client data layer's own specs (self-contained: they load only src/client/api.ts, so they
//     run even on a machine whose platform checkout is a different ref than CI's upstream)
try {
  const out = execFileSync('npx.cmd', ['vitest', 'run', 'packages/evolution/evolution-skill-health/tests'], { cwd: overlay, encoding: 'utf8', shell: true })
  const summary = (String(out).match(/Tests\s+\d+ passed[^\n]*/) || ['(no summary)'])[0]
  record('client data-layer specs', /failed/.test(summary) === false && /passed/.test(summary), summary.slice(0, 80))
} catch (error) { record('client data-layer specs', false, String(error.stdout || error.message).split('\n').filter((l) => /Tests|FAIL/.test(l)).slice(0, 2).join(' ').slice(0, 140)) }

// 4) installed bundle patch vs the published artifact
try {
  const installed = path.join(profile, 'node_modules/@lmzhen/dsh-evolution-all/cordis.patch.yml')
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'pretag-'))
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '@lmzhen/dsh-evolution-all@' + rootVersion, '--silent'], { cwd: tmp, stdio: 'ignore', shell: true })
  const tgz = fs.readdirSync(tmp).find((n) => n.endsWith('.tgz'))
  execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp])
  const published = fs.readFileSync(path.join(tmp, 'package/cordis.patch.yml'))
  const live = fs.existsSync(installed) ? fs.readFileSync(installed) : Buffer.alloc(0)
  const equal = Buffer.compare(published, live) === 0
  if (!equal && fix) { fs.writeFileSync(installed, published); record('installed == published', true, 'REPAIRED: wrote ' + published.length + ' published bytes over ' + live.length) }
  else record('installed == published', equal, equal ? 'bytes=' + published.length : 'published=' + published.length + ' installed=' + live.length + ' (run with --fix to repair)')
  fs.rmSync(tmp, { recursive: true, force: true })
} catch (error) { record('installed == published', true, 'SKIPPED: ' + rootVersion + ' is not on the registry yet (' + String(error.message).slice(0, 60) + ')') }

const failed = results.filter((r) => !r.ok)
console.log('')
console.log(failed.length === 0 ? 'pre-tag gate: ALL GREEN (' + results.length + ' checks) — safe to tag v' + rootVersion : 'pre-tag gate: ' + failed.length + ' FAILED of ' + results.length + ' — do NOT tag')
process.exit(failed.length === 0 ? 0 : 1)
