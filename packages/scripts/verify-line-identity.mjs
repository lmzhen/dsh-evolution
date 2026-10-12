#!/usr/bin/env node
/**
 * verify-line-identity — THE line-identity gate (G1.1, contract C1).
 *
 * Why: the family test bed resolved its packages through an ordered alias chain with no record of
 * which LINE each one came from, and two sources are machine state (the desktop profile, the global
 * npm closure). A re-install therefore redefined what “green” meant — it already happened once.
 *
 * The gate answers one question: **is this bed the line we think it is?** When it is not, the FIRST
 * error line is exactly `platform line mismatch` — downstream reports judge that one line instead of
 * drowning in the 73 downstream failures such a mismatch produces.
 *
 * usage:
 *   node verify-line-identity.mjs --manifest <files/line-manifest.json> [--strict] [--policy <path>]
 *   node verify-line-identity.mjs --policy-only        (CI form: no machine state available)
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIRROR = resolve(process.env.FAMILY_LINE_MIRROR ?? 'D:/dsh/dsh-evolution-mirror')
const argv = process.argv.slice(2)
const flag = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined }
const strict = argv.includes('--strict')
// The policy ships WITH the script, so the same invocation works in both layouts (mirror
// packages/scripts/ and dev packages/evolution/scripts/) and in CI.
const policyPath = flag('--policy') ?? fileURLToPath(new URL('./line-policy.json', import.meta.url))
const mismatch = []
const undeclared = []
const problems = []

if (!existsSync(policyPath)) { console.error('verify-line-identity: no policy at ' + policyPath + ' (a missing policy is not a pass)'); process.exit(2) }
let policy
try { policy = JSON.parse(readFileSync(policyPath, 'utf8')) } catch (error) { console.error('verify-line-identity: policy is not JSON: ' + error.message); process.exit(2) }
const allowed = new Set(policy.allowedKinds ?? [])
const familyKinds = new Set(policy.familyKinds ?? ['evo-src'])
const hoist = policy.profileHoist ?? {}

const missingShape = ['allowedKinds', 'familyKinds', 'profileHoist'].filter((key) => policy[key] === undefined)
if (missingShape.length > 0) problems.push('policy shape: missing ' + missingShape.join(', '))

if (argv.includes('--policy-only')) {
  const badEntries = Object.entries(hoist).filter(([, value]) => typeof value?.reason !== 'string' || value.reason.trim() === '')
  if (badEntries.length > 0) problems.push('policy shape: profileHoist entries without a reason — ' + badEntries.map(([k]) => k).join(', '))
  const undeclaredPolicy = Object.entries(hoist).filter(([, value]) => value?.status === 'undeclared').map(([k]) => k)
  for (const id of undeclaredPolicy) undeclared.push(id)
  if (problems.length > 0) { console.error('verify-line-identity [policy-only]: ' + problems.join('; ')); process.exit(1) }
  console.log('verify-line-identity [policy-only]: OK — ' + Object.keys(hoist).length + ' hoist entry(ies) declared, ' + allowed.size + ' kind(s) allowed' + (undeclared.length > 0 ? ', ' + undeclared.length + ' undeclared (see --strict)' : ''))
  if (undeclared.length > 0 && strict) process.exit(1)
  process.exit(0)
}

const manifestPath = flag('--manifest')
if (manifestPath === undefined || !existsSync(manifestPath)) { console.error('verify-line-identity: --manifest <path> is required here (a missing manifest is not a pass)'); process.exit(2) }
let manifest
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (error) { console.error('verify-line-identity: manifest is not JSON: ' + error.message); process.exit(2) }
const entries = Array.isArray(manifest.entries) ? manifest.entries : []
if (entries.length === 0) { console.error('verify-line-identity: manifest carries no entries (a vacant manifest is not a pass)'); process.exit(2) }

const pin = manifest.pin
const familyRoots = (policy.familyRoots ?? [MIRROR]).map((root) => resolve(root).toLowerCase())
const underFamilyRoot = (path) => familyRoots.some((root) => resolve(path).toLowerCase().startsWith(root))
for (const entry of entries) {
  const kind = String(entry.kind ?? '?')
  const id = String(entry.id ?? '?')
  const path = String(entry.resolvedPath ?? '')
  if (!allowed.has(kind)) { mismatch.push(id + ' resolved from ' + kind + ' which the policy does not allow'); continue }
  if (id.startsWith('@deepseek-ai/dsh-evolution-')) {
    if (!familyKinds.has(kind)) mismatch.push(id + ' is a FAMILY package but resolved from ' + kind + ' (' + path + ')')
    else if (pin !== 'unknown' && !underFamilyRoot(path)) mismatch.push(id + ' resolved outside the pinned trees (' + familyRoots.join(' | ') + '): ' + path)
  }
  if (kind === 'profile-hoist') {
    const declared = hoist[id]
    if (declared === undefined) undeclared.push(id + ' (not in the policy at all)')
    else if (declared.status === 'undeclared') undeclared.push(id + ' — ' + declared.reason)
  }
}
const hoisted = new Set(entries.filter((entry) => entry.kind === 'profile-hoist').map((entry) => entry.id))
for (const [id, value] of Object.entries(hoist)) {
  if (value?.status === 'necessary' && !hoisted.has(id)) mismatch.push(id + ' is declared necessary but the bed did not resolve it from the profile')
}

if (problems.length > 0) { console.error('verify-line-identity: ' + problems.join('; ')); process.exit(1) }
if (mismatch.length > 0) {
  console.error('platform line mismatch: the bed is not the line this run claims (pin=' + pin + ')')
  for (const line of mismatch) console.error('  - ' + line)
  process.exit(1)
}
const counts = manifest.counts ?? {}
console.log('verify-line-identity: OK — pin=' + pin + ' entries=' + entries.length + ' kinds=' + Object.entries(counts).map(([k, n]) => k + ':' + n).join(' ') + (undeclared.length > 0 ? '   [undeclared hoist: ' + undeclared.length + ']' : ''))
for (const line of undeclared) console.warn('  line-undeclared: ' + line)
if (strict && undeclared.length > 0) process.exit(1)
