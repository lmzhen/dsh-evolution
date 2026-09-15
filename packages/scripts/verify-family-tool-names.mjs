/**
 * Is every tool name the session-scoped probe asks about actually produced by a
 * family package? (v43 audit S1-1 / J-1.)
 *
 * Usage: node packages/scripts/verify-family-tool-names.mjs <packages-root> [--strict]
 *
 * `sessionAudited` answers "is this a family session?" by asking whether the
 * session's scope can see one of FAMILY_SESSION_TOOL_NAMES (opt-in.ts). Those
 * names are a hardcoded list on purpose — the platform exposes no "is this a
 * family session" API — but nothing linked the list to the tool packages that
 * PRODUCE the names: renaming a tool (or dropping a package) turned the probe
 * blind, and before S0-4 the blind spot was completely silent. This gate makes
 * the link mechanical.
 * @module verify-family-tool-names
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const root = argv[0]
const strict = argv.includes('--strict')
if (typeof root !== 'string' || root === '') {
  console.error('usage: node verify-family-tool-names.mjs <packages-root> [--strict]')
  process.exit(1)
}

const optInPath = join(root, 'evolution-core', 'src', 'opt-in.ts')
const optIn = readFileSync(optInPath, 'utf8')
const listMatch = /FAMILY_SESSION_TOOL_NAMES[^=]*=\s*\[([^\]]*)\]/.exec(optIn)
if (listMatch === null) {
  console.error('verify-family-tool-names: could not read FAMILY_SESSION_TOOL_NAMES from ' + optInPath)
  process.exit(1)
}
const listed = [...listMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1])

/** Every `defineTool({ ... name: '<tool>' })` name, per package directory. */
function producedToolNames() {
  const found = new Map()
  for (const pkg of readdirSync(root, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue
    const srcDir = join(root, pkg.name, 'src')
    let files = []
    try {
      files = readdirSync(srcDir, { recursive: true }).map(String).filter(f => f.endsWith('.ts'))
    } catch { continue }
    for (const rel of files) {
      const full = join(srcDir, rel)
      try { if (!statSync(full).isFile()) continue } catch { continue }
      const text = readFileSync(full, 'utf8')
      // The tool name is the first declared property of defineTool({...}); bound the
      // window because a full definition is far longer than any sane bound.
      for (const call of text.matchAll(/defineTool\(\{[\s\S]{0,200}?name:\s*'([^']+)'/g)) {
        found.set(call[1], pkg.name + '/' + rel)
      }
    }
  }
  return found
}

const produced = producedToolNames()
const stale = listed.filter(name => !produced.has(name))
const unlisted = [...produced.keys()].filter(name => !listed.includes(name)).sort()

const summary = 'verify-family-tool-names: listed=' + listed.length + ' produced=' + produced.size + ' stale=' + stale.length
console.log(summary)
console.log('  probe list: ' + listed.join(', '))
console.log('  family tools not probed (informational; profile-root rows like maintenance_probe MUST stay out): ' + (unlisted.length > 0 ? unlisted.join(', ') : '(none)'))
if (stale.length > 0) {
  console.error('  STALE probe name(s) with no producing package: ' + stale.join(', '))
  console.error('  Fix: rename the entry in FAMILY_SESSION_TOOL_NAMES to the tool the package registers')
  console.error('  (ctx.tools.register(defineTool({ name }))), or drop the entry. A stale name makes')
  console.error('  the session-scoped gate blind for the row it was meant to detect.')
  if (strict) process.exit(1)
}
