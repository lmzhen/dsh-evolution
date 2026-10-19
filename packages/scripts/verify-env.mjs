#!/usr/bin/env node
/**
 * verify-env — print the portable fixture resolution table and refuse to call a replay "ready"
 * when a REQUIRED root cannot be resolved (遗留⑤).
 *
 *   node packages/scripts/verify-env.mjs            human table, exit 0 all resolved / 2 otherwise
 *   node packages/scripts/verify-env.mjs --json     machine form for scripts and evidence
 *
 * Overrides (each also has a workspace candidate, so a plain checkout usually needs none):
 *   EVOLUTION_OVERLAY_ROOT   platform/disposable build line (e.g. D:/dsh/harness-0.2.1)
 *   EVOLUTION_PROFILE        live profile the bed hoists from
 *   FAMILY_LINE_ADAPTER      external lib-line.mjs (default: <workspace>/_tools/lib-line.mjs)
 *   FAMILY_NPM_GLOBAL        npm global node_modules root (default: `npm root -g`)
 */
import { adapterCandidates, describe, npmGlobalRoot, overlayCandidates, profileCandidates, resolveAdapter, resolveOverlay, resolveProfile } from './lib-env.mjs'

const json = process.argv.includes("--json")
const env = process.env
const table = describe(env)
const required = [
  { key: "overlay", value: resolveOverlay(env), envVar: "EVOLUTION_OVERLAY_ROOT", candidates: overlayCandidates(env) },
  { key: "profile", value: resolveProfile(env), envVar: "EVOLUTION_PROFILE", candidates: profileCandidates(env) },
  { key: "adapter", value: resolveAdapter(env), envVar: "FAMILY_LINE_ADAPTER", candidates: adapterCandidates(env) },
]
const missing = required.filter((row) => row.value === null)
if (json) {
  console.log(JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), resolution: table, required, missing, npmGlobal: npmGlobalRoot(env) }, null, 2))
} else {
  console.log("verify-env: layout=" + table.layout)
  console.log("  scripts   " + table.scriptsDir)
  console.log("  packages  " + table.packagesRoot)
  console.log("  repo      " + table.repoRoot)
  for (const row of required) console.log("  " + row.key.padEnd(9) + (row.value ?? ("MISSING — set " + row.envVar + " (candidates: " + row.candidates.join(", ") + ")")))
  console.log("  npmGlobal " + npmGlobalRoot(env))
}
if (missing.length > 0) {
  console.error("verify-env: CANNOT DECIDE — " + String(missing.length) + " required fixture root(s) unresolved (" + missing.map((row) => row.envVar).join(", ") + ")")
  process.exit(2)
}
process.exit(0)
