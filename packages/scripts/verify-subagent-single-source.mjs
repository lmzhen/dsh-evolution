#!/usr/bin/env node
/**
 * G3-S6 arch guard: the family has ONE subagent execution path (evolution-core's Channel).
 *
 * 0.2.1 removed `subagents.start` / `SubagentStartRequest.persona|toolFilter` / `SubagentRun.localAgent`.
 * A business package that still reaches for them compiles against stale local views and fails at run
 * time (review silently degraded to inject; maintenance threw at startup). This guard scans PRODUCTION
 * sources only: test fixtures legitimately bridge the legacy fake shape and are exempt by scope.
 *
 * Usage: node packages/scripts/verify-subagent-single-source.mjs <evolution-root> [--json]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const argv = process.argv.slice(2)
const root = resolve(argv.find((arg) => !arg.startsWith('--')) ?? 'packages')
const JSON_OUT = argv.includes('--json')
const OWNER = 'evolution-core/src/subagent/channel.ts'
const FORBIDDEN = [
  [/\.start\('spawn'/, 'legacy subagents.start(spawn) call'],
  [/subagents\.start\(/, 'legacy subagents.start() call'],
  [/withSettleWatchdog/, 'retired settle watchdog'],
  [/\.localAgent/, 'retired SubagentRun.localAgent evidence probe'],
  [/toolFilter\s*:/, 'retired toolFilter request field'],
  [/persona\s*:/, 'retired persona request field'],
  [/MaintainSubagent/, 'retired maintenance subagent view types'],
]
const hits = []
let scanned = 0

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist' || entry.name === 'tests') continue
    if (dir === root && (entry.name === 'scripts' || entry.name === 'test-support')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    if (!/\.(?:ts|mts|cts|mjs|js)$/.test(entry.name)) continue
    const rel = relative(root, full).split(/[\\/]/).join('/')
    // Production sources only: `packages/<pkg>/src/**`. Tests and the two shared tooling trees
    // (scripts/, test-support/) legitimately carry the legacy fixture/adapter shapes.
    if (!rel.includes('/src/')) continue
    scanned += 1
    const lines = readFileSync(full, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (rel !== OWNER && line.includes('startActivation')) hits.push({ file: rel, line: index + 1, rule: 'startActivation outside the channel owner' })
      for (const [pattern, rule] of FORBIDDEN) {
        if (pattern.test(line)) hits.push({ file: rel, line: index + 1, rule })
      }
    })
  }
}

walk(root)
// The owner file must still BE the single caller of startActivation.
if (!existsSyncSafe(join(root, OWNER))) hits.push({ file: OWNER, line: 0, rule: 'channel owner file is missing' })

function existsSyncSafe(path) {
  try { readFileSync(path); return true } catch { return false }
}

if (hits.length > 0) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, scanned, hits }, null, 2))
  else {
    console.error('verify-subagent-single-source: ' + hits.length + ' legacy-API hit(s) in production sources:')
    for (const hit of hits) console.error('  - ' + hit.file + ':' + hit.line + ' ' + hit.rule)
  }
  process.exit(1)
}
if (scanned === 0) {
  console.error('verify-subagent-single-source: scanned 0 sources under ' + root + ' — the guard would be silent')
  process.exit(2)
}
if (JSON_OUT) console.log(JSON.stringify({ ok: true, scanned }, null, 2))
else console.log('verify-subagent-single-source: OK — ' + scanned + ' production source(s), one execution path (evolution-core channel)')
