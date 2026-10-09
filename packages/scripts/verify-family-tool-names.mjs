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

/** A name property inside a defineTool call. Three quote styles: the family uses all of them. */
const TOOL_NAME_RE = /(?:^|[{,\s])name:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/

/**
 * Every `defineTool(...)` name in one file, quote-agnostic and bracket-balanced.
 *
 * v46 S1.10 (finding T7-10): the previous rule bounded the search at 200 characters, so a
 * definition whose docblock or arguments pushed `name` past that window was invisible — the probe
 * entry for it then read as STALE (a false red that told the maintainer to rename a live tool),
 * while a genuine rename could escape through the same hole. The slice now runs to the call's
 * matching close paren. Caveat: an unbalanced paren inside a string in the same call would end the
 * slice early; the family's descriptions are balanced, and the vacuum check below catches the case
 * where the scan finds nothing at all.
 * @param text - the file's source.
 * @returns the tool names it declares.
 */
function definedToolNames(text) {
  const names = []
  const marker = 'defineTool('
  for (let index = text.indexOf(marker); index >= 0; index = text.indexOf(marker, index + 1)) {
    let depth = 0
    let end = text.length - 1
    for (let cursor = index + marker.length - 1; cursor < text.length; cursor += 1) {
      const char = text[cursor]
      if (char === '(') depth += 1
      else if (char === ')') {
        depth -= 1
        if (depth === 0) { end = cursor; break }
      }
    }
    const match = TOOL_NAME_RE.exec(text.slice(index, end + 1))
    if (match !== null) names.push(match[1] ?? match[2] ?? match[3])
  }
  return names
}

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
      for (const name of definedToolNames(text)) found.set(name, pkg.name + '/' + rel)
    }
  }
  return found
}

const produced = producedToolNames()
// v46 S1.10: a vacuum is not a pass. An empty probe list or an empty scan means the gate cannot
// decide anything, and both used to report a comfortable zero.
if (listed.length === 0) {
  console.error('verify-family-tool-names: FAMILY_SESSION_TOOL_NAMES parsed empty — the probe list itself cannot be checked')
  process.exit(1)
}
if (produced.size === 0) {
  console.error('verify-family-tool-names: no defineTool(…) name found under ' + root + ' — the scan found nothing to compare (a vacuum pass is not a pass)')
  process.exit(1)
}
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
