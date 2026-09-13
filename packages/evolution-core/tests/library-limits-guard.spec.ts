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
 *
 * v41 P2-26 (0.3.75) moved the construction itself into core's
 * `newSkillLibrary()` (arch rule N7 owns "no direct `new SkillLibrary`"), so
 * the decision now sits at the helper boundary: a call either names
 * `limits:` or it takes the defaults and belongs in this register.
 */
const REGISTERED_DEFAULTS: Record<string, string> = {
  'evolution-commands/src/index.ts :: { config: { root: skillsRootValue }, io: ioRegistry.provider() }': 'read-only: the commands listing walks the tree, no write goes through this instance',
  'evolution-commands/src/index.ts :: { config: { root: skillsRootValue }, io: ioRegistry.provider() } #2': 'read-only: as above',
  'evolution-commands/src/index.ts :: { config: { root: skillsRootValue }, io: ioRegistry.provider(), ctx, threatExemptLabels: config.threatExemptLabels }': 'KNOWN GAP (v35 A6): library.restructure validates with DEFAULT caps; only diverges when the deployment configures non-default limits',
  'evolution-curator/src/index.ts :: { config, io: this.io, ctx: this.ctx }': 'KNOWN GAP (v35 A6): archive/consolidate validate with DEFAULT caps; the curator reads its own config, not the policy snapshot',
  'evolution-learning-graph/src/index.ts :: { config: rawConfig, io: evolutionIoAdapter(() => io.provider()), ctx, threatExemptLabels: rawConfig.threatExemptLabels }': 'read-only: withSkills() serves reads and the graph read path',
  'evolution-maintenance/src/tools.ts :: { config: rootConfig, io: ioRegistry.provider() }': 'read-only: the maintenance probe walks the tree',
  'evolution-review/src/index.ts :: { config: rootConfig, io: evolutionIoAdapter(() => io.provider()) }': 'read-only: the pre-run hash snapshot',
  'evolution-review/src/index.ts :: { config: rootConfig, io: evolutionIoAdapter(() => io.provider()) } #2': 'KNOWN GAP (v35 A6): the direct-path executor writes; the construction above it (with policy limits) serves the plan path only',
  'evolution-skill-catalog/src/index.ts :: { config: rawConfig, io }': 'read-only: the catalog walk',
}

const WRITE_CALL = /\.(?:create|update|patch|archive|writeSupportFile|removeSupportFile|setPinned|restructure|consolidate)\(/
/** The helper, by name. The def line (`export function newSkillLibrary(`) is
 * not a call site; every construction below it stays single-sourced. */
const CALL_SITE = /newSkillLibrary\(/
const DEFINITION = /function\s+newSkillLibrary\s*\(/

/** Prose is not a call site, and a masked real call would surface as a STALE
 * register entry — the failure direction stays loud either way. */
function withoutLineComments(line: string): string {
  const at = line.indexOf('//')
  return at < 0 ? line : line.slice(0, at)
}

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

/** The construction call text, paren-balanced, keyed by its argument text. */
function constructions(text: string, file: string): Array<{ key: string; limits: boolean }> {
  const lines = text.split(/\r?\n/)
  const found: Array<{ key: string; limits: boolean }> = []
  // v39 (B3 follow-up): the register is keyed by CONTENT, not by line number.
  // Two rounds in a row, an unrelated edit above a construction re-pinned every
  // entry and failed this guard; the anchor is the normalized argument list, so
  // only a real change to the construction (or a new duplicate) fires it.
  const perAnchor = new Map<string, number>()
  lines.forEach((line, index) => {
    const code = withoutLineComments(line)
    if (!CALL_SITE.test(code) || DEFINITION.test(code)) return
    let depth = 0
    const parts: string[] = []
    for (let i = index; i < lines.length && parts.length < 12; i++) {
      const raw = lines[i]
      if (raw === undefined) break
      const source = withoutLineComments(raw)
      parts.push(source)
      for (const ch of source) {
        if (ch === '(') depth++
        else if (ch === ')') depth--
      }
      if (depth <= 0 && parts.length > 0) break
    }
    const call = parts.join(' ').replace(/\s+/g, ' ')
    const args = call.slice(call.indexOf('newSkillLibrary(') + 'newSkillLibrary('.length, -1)
    // Trailing commas are FORMATTING, not content: reformatting a call into
    // the repo's multi-line style must not re-pin the register.
    const anchor = args.trim().replace(/\s+/g, ' ').replace(/,\s*\}$/, ' }')
    const nth = perAnchor.get(anchor) ?? 0
    perAnchor.set(anchor, nth + 1)
    const suffix = nth === 0 ? '' : ` #${nth + 1}`
    // The defaults decision is the ABSENCE of the named option — no positional
    // index to count any more (`limits: undefined` is an explicit decision).
    found.push({ key: `${file} :: ${anchor}${suffix}`, limits: /(?:^|[{,\s])limits:/.test(anchor) })
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
        unregistered.push(`  '${site.key}': '<reason>',   // ${writes}`)
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
