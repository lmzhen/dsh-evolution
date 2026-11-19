#!/usr/bin/env node
/**
 * Cohort smoke: read one LIVE DSH web host and prove every family row the bundle
 * patch declares is active (or, for `disabled: true` rows, deliberately inactive).
 *
 * This is the runtime half of P1. Compiling and starting are not enough: the platform
 * compatibility preflight disables incompatible entries and only logs to stderr, so a
 * green `dsh web` can still hide a dead family. The platform's own inventory endpoint
 * is the authoritative live view (GET is not enough; it is a typert client-request).
 *
 * Usage:
 *   node packages/scripts/verify-cohort-smoke.mjs --url http://127.0.0.1:3090 \
 *     --token <gui-token> [--scope @lmzhen] [--json]
 *
 * Exit 0 only when every expected active row is enabled and fiber-active, every
 * deliberately disabled row is not active, and doctor reports platform-services ok.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(dirname(HERE))
const args = process.argv.slice(2)
const valueOf = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const baseUrl = valueOf('--url')
const token = valueOf('--token')
const scope = valueOf('--scope') ?? '@lmzhen'
const jsonOut = args.includes('--json')
const rowsFile = join(HERE, 'bundle-rows.json')

if (baseUrl === undefined || token === undefined) {
  console.error('verify-cohort-smoke: --url and --token are required')
  process.exit(2)
}

function nameOf(body) {
  for (const line of body ?? []) {
    const match = /^\s*name:\s*'([^']+)'\s*$/.exec(line)
    if (match !== null) return match[1]
  }
  return undefined
}

function expectedRows() {
  if (!existsSync(rowsFile)) throw new Error('missing bundle-rows.json at ' + rowsFile)
  const source = JSON.parse(readFileSync(rowsFile, 'utf8'))
  const rows = []
  for (const row of source.rows ?? []) {
    if (!Array.isArray(row.forms) || !row.forms.includes('all')) continue
    const rawName = nameOf(row.body)
    if (rawName === undefined) continue
    const disabled = (row.body ?? []).some((line) => /^\s*disabled:\s*true\s*$/.test(line))
    rows.push({ id: row.id, name: rawName.replace('@deepseek-ai/', scope + '/'), disabled })
  }
  return rows
}

async function login() {
  const response = await fetch(baseUrl + '/?token=' + encodeURIComponent(token), { redirect: 'manual' })
  if (response.status !== 303 && response.status !== 200) {
    throw new Error('login returned HTTP ' + String(response.status))
  }
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  if (cookies.length === 0) throw new Error('login set no auth cookie')
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

async function rpc(cookie, method, payload) {
  const response = await fetch(baseUrl + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: 'cohort-smoke', method, payload }),
  })
  const body = await response.json()
  if (body?.result?.ok !== true) throw new Error(method + ' failed: ' + JSON.stringify(body?.result?.error ?? body))
  return body.result.value
}

async function getJson(cookie, path) {
  const response = await fetch(baseUrl + path, { headers: { cookie } })
  const body = await response.json()
  if (body?.ok !== true) throw new Error(path + ' failed: ' + JSON.stringify(body))
  return body.data
}

const rows = expectedRows()
const cookie = await login()
const inventory = await rpc(cookie, 'pluginInventory/list', { args: {} })
const entries = Array.isArray(inventory?.entries) ? inventory.entries : []
const byName = new Map(entries.map((entry) => [entry.moduleName, entry]))

const diagnostics = await getJson(cookie, '/api/dsh-evolution/diagnostics')
const facts = Array.isArray(diagnostics?.facts) ? diagnostics.facts : []
const runtime = Array.isArray(diagnostics?.runtime) ? diagnostics.runtime : []
const family = facts.find((fact) => fact.key === 'family-version')?.value
const platform = facts.find((fact) => fact.key === 'platform-line')?.value
const services = runtime.find((row) => row.key === 'platform-services')?.status

const failures = []
const active = []
const inactive = []
for (const row of rows) {
  const entry = byName.get(row.name)
  const isActive = entry?.enabled === true && entry?.fiberPhase === 'active'
  if (row.disabled) {
    if (isActive) failures.push(row.id + ' is declared disabled but is active')
    else inactive.push(row.id)
    continue
  }
  if (entry === undefined) failures.push(row.id + ' (' + row.name + ') is missing from the live inventory')
  else if (!isActive) failures.push(row.id + ' (' + row.name + ') is enabled=' + String(entry.enabled) + ' phase=' + String(entry.fiberPhase))
  else active.push(row.id)
}
if (services !== 'ok') failures.push('doctor platform-services is ' + String(services))

const report = {
  ok: failures.length === 0,
  url: baseUrl,
  family,
  platform,
  services,
  expected: rows.length,
  active,
  inactive,
  failures,
}
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else {
  console.log('family ' + String(family) + ' on ' + String(platform))
  console.log('active rows: ' + String(active.length) + '/' + String(rows.filter((row) => !row.disabled).length))
  console.log('disabled rows: ' + (inactive.length === 0 ? 'none' : inactive.join(', ')))
  console.log('doctor platform-services: ' + String(services))
  if (!report.ok) for (const failure of failures) console.error('FAIL ' + failure)
  else console.log('verify-cohort-smoke: OK')
}
if (!report.ok) process.exit(1)
