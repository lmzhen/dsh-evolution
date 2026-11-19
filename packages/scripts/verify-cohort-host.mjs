#!/usr/bin/env node
/**
 * Host acceptance for one platform cohort member: install the packed family
 * into a fresh DSH home, start the real web host, run the live row smoke, and
 * write one release-evidence cohort reading.
 *
 * This is the reproducible local/CI body behind the cohort claim; it does not
 * trust a hand-written reading. The platform CLI is supplied by the caller so
 * the same script can test every cohort member without a version branch.
 *
 * Usage:
 *   node packages/scripts/verify-cohort-host.mjs \
 *     --dist packages/evolution/dist --home <fresh-dir> \
 *     --version 0.2.2-rc.4 --cli <path/to/dsh/lib/bin.js> \
 *     --port 3097 --source local --out cohort-reading.json [--keep]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(dirname(HERE))
const args = process.argv.slice(2)
const valueOf = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const required = (name) => {
  const value = valueOf(name)
  if (value === undefined) {
    console.error('verify-cohort-host: ' + name + ' is required')
    process.exit(2)
  }
  return value
}

const dist = resolve(required('--dist'))
const home = resolve(required('--home'))
const version = required('--version')
const cli = resolve(required('--cli'))
const port = Number(required('--port'))
const source = valueOf('--source') ?? 'local'
const out = valueOf('--out')
const profile = valueOf('--profile') ?? 'web'
const scope = valueOf('--scope') ?? '@lmzhen'
const keep = args.includes('--keep')

if (!existsSync(dist)) { console.error('verify-cohort-host: no dist at ' + dist); process.exit(2) }
if (!existsSync(cli)) { console.error('verify-cohort-host: no platform CLI at ' + cli); process.exit(2) }
if (!['ci', 'local'].includes(source)) { console.error('verify-cohort-host: --source must be ci/local'); process.exit(2) }

const installerArg = valueOf('--installer')
const installerCandidates = [
  ...(installerArg === undefined ? [] : [resolve(installerArg)]),
  join(ROOT, 'packages', 'evolution', 'scripts', 'install-layered.mjs'),
  join(ROOT, 'packages', 'scripts', 'install-layered.mjs'),
]
const installer = installerCandidates.find((candidate) => existsSync(candidate))
if (installer === undefined) { console.error('verify-cohort-host: install-layered.mjs not found (pass --installer)'); process.exit(2) }
const installerCwd = valueOf('--installer-cwd') === undefined ? ROOT : resolve(valueOf('--installer-cwd'))

if (!keep && existsSync(home)) rmSync(home, { recursive: true, force: true })
mkdirSync(home, { recursive: true })

const install = spawnSync(process.execPath, [installer, '--from-dist', dist, '--home', home, '--profile', profile, '--mode', 'all', '--force'], {
  cwd: installerCwd,
  encoding: 'utf8',
})
if (install.status !== 0) {
  console.error('verify-cohort-host: install failed\n' + (install.stdout ?? '') + (install.stderr ?? ''))
  process.exit(1)
}

const host = spawn(process.execPath, [cli, '--profile', profile, '--no-open', '--port', String(port)], {
  cwd: ROOT,
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
host.stdout.on('data', (chunk) => { output += String(chunk) })
host.stderr.on('data', (chunk) => { output += String(chunk) })

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
let token
for (let index = 0; index < 180; index += 1) {
  await sleep(1000)
  const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s]+)/.exec(output)
  if (match !== null) { token = match[1]; break }
  if (host.exitCode !== null) break
}
if (token === undefined) {
  console.error('verify-cohort-host: host did not print a login URL\n' + output)
  host.kill()
  process.exit(1)
}

function stopHost() {
  if (host.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(host.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    host.kill('SIGTERM')
  }
}

try {
  const smoke = spawnSync(process.execPath, [join(HERE, 'verify-cohort-smoke.mjs'), '--url', 'http://127.0.0.1:' + String(port), '--token', token, '--scope', scope, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (smoke.status !== 0) {
    console.error('verify-cohort-host: smoke failed\n' + (smoke.stdout ?? '') + (smoke.stderr ?? ''))
    process.exit(1)
  }
  const report = JSON.parse(smoke.stdout)
  const inactive = Array.isArray(report.inactive) ? report.inactive : []
  const reading = {
    version,
    install: 'clean',
    boot: 200,
    activeRows: Array.isArray(report.active) ? report.active.length : 0,
    expectedActiveRows: (Number.isInteger(report.expected) ? report.expected : 0) - inactive.length,
    disabledRows: inactive,
    doctor: report.services === 'ok' ? 'ok' : String(report.services),
    smoke: report.ok === true ? 'pass' : 'fail',
    source,
  }
  if (reading.smoke !== 'pass' || reading.doctor !== 'ok') {
    console.error('verify-cohort-host: reading is not a pass: ' + JSON.stringify(reading))
    process.exit(1)
  }
  if (out !== undefined) writeFileSync(resolve(out), JSON.stringify(reading, null, 2) + '\n')
  console.log(JSON.stringify(reading, null, 2))
} finally {
  stopHost()
  if (!keep) rmSync(home, { recursive: true, force: true })
}
