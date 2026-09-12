import { expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * v35 A6 guard: every SkillLibrary construction is a DECISION about limits.
 *
 * Ten of the eleven production constructions take the library defaults. Six of
 * those are read-only (a listing or a hash walk validates nothing, so the
 * defaults are inert there). Three are writers, and a writer with defaults
 * silently validates against DEFAULT caps instead of the deployment's — the
 * exact drift REV-04 recorded when the review could write 10× the configured
 * cap. Fixing those three means threading a policy snapshot into packages that
 * may not read one; this guard pins the reviewed set instead, so a NEW
 * construction (or a new write call in a previously read-only module) fails
 * here and forces the decision, while the register below stays the to-do list.
 */
const REGISTERED_DEFAULTS: Record<string, string> = {
  'evolution-commands/src/index.ts:389': 'read-only: the commands listing walks the tree, no write goes through this instance',
  'evolution-commands/src/index.ts:468': 'read-only: as above',
  'evolution-commands/src/index.ts:676': 'KNOWN GAP (v35 A6): library.restructure validates with DEFAULT caps; only diverges when the deployment configures non-default limits',
  'evolution-curator/src/index.ts:214': 'KNOWN GAP (v35 A6): archive/consolidate validate with DEFAULT caps; the curator reads its own config, not the policy snapshot',
  'evolution-learning-graph/src/index.ts:451': 'read-only: withSkills() serves reads and the graph read path',
  'evolution-maintenance/src/tools.ts:78': 'read-only: the maintenance probe walks the tree',
  'evolution-review/src/index.ts:760': 'read-only: the pre-run hash snapshot',
  'evolution-review/src/index.ts:1101': 'KNOWN GAP (v35 A6): the direct-path executor writes; the construction above it (with policy limits) serves the plan path only',
  'evolution-skill-catalog/src/index.ts:93': 'read-only: the catalog walk',
}

const WRITE_CALL = /\.(?:create|update|patch|archive|writeSupportFile|removeSupportFile|setPinned|restructure|consolidate)\(/

interface SourceFile {
  /** Family-relative path, identical in every tree the family is checked out in. */
  key: string
  text: string
}

/** Every TypeScript source file under each package's src directory. */
function sourceFiles(): SourceFile[] {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const out: SourceFile[] = []
  for (const pkg of readdirSync(root)) {
    const src = join(root, pkg, 'src')
    try {
      if (!statSync(src).isDirectory()) continue
    } catch { continue }
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.endsWith('.ts')) continue
        const key = pkg + '/src/' + relative(src, full).replace(/\\/g, '/')
        out.push({ key, text: readFileSync(full, 'utf8') })
      }
    }
    walk(src)
  }
  return out
}

/** The construction call text, paren-balanced, with its 1-based line. */
function constructions(text: string, file: string): Array<{ key: string; limits: boolean }> {
  const lines = text.split(/\r?\n/)
  const found: Array<{ key: string; limits: boolean }> = []
  lines.forEach((line, index) => {
    const at = line.indexOf('new SkillLibrary(')
    if (at < 0) return
    let depth = 0
    const parts: string[] = []
    for (let i = index; i < lines.length && parts.length < 8; i++) {
      const source = lines[i]
      if (source === undefined) break
      parts.push(source)
      for (const ch of source) {
        if (ch === '(') depth++
        else if (ch === ')') depth--
      }
      if (depth <= 0 && parts.length > 0) break
    }
    const call = parts.join(' ').replace(/\s+/g, ' ')
    const args = call.slice(call.indexOf('new SkillLibrary(') + 'new SkillLibrary('.length, -1)
    // The 3rd argument (index 2) carries the limits; an explicit `undefined`
    // is the same decision as omitting it.
    let level = 0
    let commas = 0
    let third = ''
    for (const ch of args) {
      if (ch === '(' || ch === '[' || ch === '{') level++
      else if (ch === ')' || ch === ']' || ch === '}') level--
      else if (ch === ',' && level === 0) { commas++; continue }
      if (commas === 2) third += ch
    }
    found.push({ key: `${file}:${index + 1}`, limits: third.trim() !== '' && third.trim() !== 'undefined' })
  })
  return found
}

it('v35 A6: every SkillLibrary construction with default limits is a registered decision', () => {
  const unregistered: string[] = []
  const seen = new Set<string>()
  for (const file of sourceFiles()) {
    for (const site of constructions(file.text, file.key)) {
      if (site.limits) continue
      seen.add(site.key)
      const reason = REGISTERED_DEFAULTS[site.key]
      if (reason === undefined) {
        const writes = WRITE_CALL.test(file.text) ? 'module contains write calls' : 'module is read-only'
        unregistered.push(site.key + ' (' + writes + ')')
      }
    }
  }
  expect(unregistered).toEqual([])
  // No vacuous pass: the register names the constructions that still take the
  // defaults, and a stale entry (a site that gained limits, moved, or vanished)
  // must be removed rather than left as a silent blanket exemption.
  const stale = Object.keys(REGISTERED_DEFAULTS).filter(key => !seen.has(key))
  expect(stale).toEqual([])
})
