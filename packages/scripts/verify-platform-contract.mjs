#!/usr/bin/env node
/**
 * Platform-contract probe (v33 G4.2): given a platform checkout, report every
 * place the family's host surface has moved.
 *
 * Three checks, all read-only and all mechanical:
 *   1. CONTRACT_ANCHORS — signature text the family (or its upgrade checklist)
 *      depends on, RECORDED from the 0.1.5-rc.2 line the family now ships
 *      against (re-recorded at v33 G0 completion; the 0.1.1-rc.2 baseline these
 *      replaced is in git history). Each anchor's exact
 *      text must still appear in the named platform file; a rename or removal
 *      is reported with the finding id it implements.
 *   2. Imported symbols — every `@deepseek-ai/dsh-*` value/type the family
 *      imports from a platform package must still be exported by that package.
 *   3. Service names — every service the family reads through `ctx.get(name)`
 *      must be provided by the family or by the platform.
 *
 * It is a DETECTOR, not a compatibility layer: nothing here runs on the plugin
 * path, and no check adapts the family to an older platform. A red run is the
 * upgrade entry point — read the diffs, take the decision in the plan, then
 * re-record. Asymmetric by design: it reports anchors the baseline HAD, never
 * platform additions (those are the checklist's re-verification job — see
 * `docs/upstream-contract-checklist.md`, items 16-18).
 *
 * Two modes, for the two states of the family:
 *   - default (the SHIPPED state): every difference exits 1. The anchors match
 *     the line the family ships against, so a green run means "the platform
 *     surface this family depends on has not moved" — which is why CI runs this
 *     mode now that v33 re-recorded the anchors.
 *   - `--accept-recorded` (the NEXT upgrade's working mode): a difference a
 *     recorded anchor accounts for is printed but does not fail, so the new
 *     target line can be green once each move has a decision. Every check NOT
 *     backed by a recorded anchor — an imported symbol or service name the
 *     platform dropped, a section-order scale that reached the family's window
 *     — still fails. When the family finishes that migration, re-record the
 *     anchors to the new line and drop the flag again.
 *
 * Usage (both paths are REQUIRED — no hardcoded machine layouts):
 *   node <scripts-dir>/verify-platform-contract.mjs <evolution-root> \
 *     --upstream <platform-tree> [--accept-recorded]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const familyRoot = resolve(argv[0] ?? '')
const upstreamArg = argv.indexOf('--upstream')
const upstream = upstreamArg >= 0 ? resolve(argv[upstreamArg + 1] ?? '') : ''
const acceptRecorded = argv.includes('--accept-recorded')
if (!argv[0] || upstream === '' || argv[upstreamArg + 1] === undefined || argv[upstreamArg + 1].startsWith('--')) {
  console.error('usage: verify-platform-contract.mjs <evolution-root> --upstream <platform-tree> [--accept-recorded] (first two required)')
  process.exit(2)
}

/**
 * Recorded host-surface anchors, taken from the 0.1.5-rc.2 line the family now
 * ships against (v33 re-record; the pre-migration texts are in git history).
 * Each anchor's `consumer` says who depends on it and, where the surface was
 * renamed in v33, which migration step re-pointed the family at it. `finding`
 * names the v33 audit item the anchor
 * implements; `consumer` says who depends on it (`none` = recorded because the
 * upgrade checklist tracks that surface, not because the family calls it).
 */
const CONTRACT_ANCHORS = [
  {
    id: 'session-events-accessor',
    file: 'packages/core/session/src/index.ts',
    anchor: 'snapshotEvents(',
    consumer: 'evolution-core/signals.ts, evolution-review, evolution-curator (session log reads; migrated in v33 G0.1)',
    finding: 'P0-1',
  },
  {
    id: 'call-id-brand',
    file: 'packages/llm/llm/src/brand.ts',
    anchor: "export type ToolCallId = Branded<'ToolCallId'>",
    consumer: 'family tests (createToolResultMessage arguments; migrated in v33 G0.2)',
    finding: 'P1-2',
  },
  {
    id: 'tool-presentation-mode',
    file: 'packages/core/tools/src/index.ts',
    anchor: "export type ToolPresentationMode = 'native' | 'ptc' | 'both'",
    consumer: 'the `tools` row config contract the family bundles document',
    finding: 'P2-A1',
  },
  {
    id: 'tool-presentation-mode-schema',
    file: 'packages/core/tools/src/index.ts',
    anchor: "mode: z.union(['native', 'ptc', 'both'] as const).default('native'),",
    consumer: 'the `tools` row config contract (default value)',
    finding: 'P2-A1',
  },
  {
    id: 'command-input-images',
    file: 'packages/interaction/commands/src/types.ts',
    anchor: 'readonly attachments?: boolean',
    consumer: 'none — the family builds only {kind,text} command results (descriptor field renamed images→attachments)',
    finding: 'P2-A3',
  },
  {
    id: 'code-dispatch-waterfall',
    file: 'packages/core/tools/src/index.ts',
    anchor: "'tools/ptc-dispatch-log'(this: Scoped<ToolRuntime>",
    consumer: 'none — the family observes tool/call and tool/result',
    finding: 'P2-A2',
  },
  {
    id: 'code-dispatch-event',
    file: 'packages/core/session/src/known-event-types.ts',
    anchor: "'tool/ptc-dispatch',",
    consumer: 'none — durable event renamed with the code→ptc rename',
    finding: 'P2-A2',
  },
  {
    id: 'code-only-section',
    file: 'packages/core/tools/src/index.ts',
    anchor: "name: 'tools:ptc-only',",
    consumer: 'none — prompt section renamed with the code→ptc rename',
    finding: 'P2-A2',
  },
  {
    id: 'session-format-version',
    file: 'packages/core/session/src/types.ts',
    anchor: 'export const SESSION_FORMAT_VERSION = 3',
    consumer: 'evolution-review persistence fixtures (v3 headers; re-recorded with the 0.1.5 fixture rewrite)',
    finding: 'P2-B1',
  },
  {
    id: 'session-header-seed-length',
    file: 'packages/core/session/src/types.ts',
    anchor: 'readonly inheritedEventCount?: SessionLogOffset',
    consumer: 'none — the header seed field became inheritedEventCount (SessionLogOffset)',
    finding: 'P2-B1',
  },
  {
    id: 'persona-section-name',
    file: 'packages/core/system-prompt/src/index.ts',
    anchor: 'DEPLOYMENT_PERSONA_PREFIX: 0,',
    consumer: 'none — the persona section split into prefix/suffix section orders',
    finding: 'P1-3 (order scale) / persona split',
  },
  {
    id: 'persona-order-literal',
    file: 'packages/core/system-prompt/src/index.ts',
    anchor: 'DEPLOYMENT_PERSONA_SUFFIX: 10200,',
    consumer: 'the family guidance sections (orders 11000/11100) must stay above this ceiling',
    finding: 'P1-3',
  },
  {
    id: 'app-boot-manifest-type',
    file: 'packages/util/package-manifest/src/types.ts',
    anchor: 'export interface DshProfileManifest {',
    consumer: 'none — the family imports loadOverlayPatches/composeEntries only (manifest types moved to dsh-package-manifest)',
    finding: 'P2-D4',
  },
  {
    id: 'llm-runtime-base',
    file: 'packages/llm/llm/src/index.ts',
    anchor: 'export class LlmRuntime extends TypertRemoteService {',
    consumer: 'none — the family consumes the service, never extends it',
    finding: 'P2-F2',
  },
]

/** Directories never worth scanning for platform facts. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'dist', 'tests', 'coverage', '.release-staging'])

/** Both shapes a Cordis service registration takes: a `Service` subclass
 * (`super(ctx, 'name')`) and a plain `ctx.provide('name', value)`. */
const SERVICE_DECLARATION = /(?:super\(ctx,\s*|\.provide\()'([^']+)'/g

/**
 * Walk a tree and hand every `.ts` source to `visit`.
 * @param dir - directory to walk.
 * @param visit - called with the absolute path and the file content.
 */
function walkSources(dir, visit) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkSources(path, visit)
      continue
    }
    if (!/\.ts$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue
    visit(path, readFileSync(path, 'utf8'))
  }
}

/** Platform package directories by package name, from `<upstream>/packages`. */
function platformPackages() {
  const found = new Map()
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      const manifestPath = join(path, 'package.json')
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
          if (typeof manifest.name === 'string' && !found.has(manifest.name)) found.set(manifest.name, path)
        } catch {
          // An unreadable manifest is not a contract fact; skip it.
        }
      }
      walk(path, depth + 1)
    }
  }
  walk(join(upstream, 'packages'), 0)
  return found
}

/**
 * Names one platform package exports from its `src` tree.
 * @param dir - the package directory.
 * @returns the exported names (declarations, re-export lists, star targets).
 */
function exportedNames(dir) {
  const names = new Set()
  walkSources(join(dir, 'src'), (_path, text) => {
    for (const match of text.matchAll(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
      names.add(match[1])
    }
    for (const match of text.matchAll(/^export\s+\{([^}]*)\}/gm)) {
      for (const part of match[1].split(',')) {
        const trimmed = part.trim().replace(/^type\s+/, '')
        if (trimmed === '') continue
        names.add((trimmed.split(/\s+as\s+/)[1] ?? trimmed).trim())
      }
    }
    for (const match of text.matchAll(/^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm)) {
      names.add(`* from ${match[1]}`)
    }
  })
  return names
}

const recordedDrift = []
for (const entry of CONTRACT_ANCHORS) {
  const path = join(upstream, entry.file)
  if (!existsSync(path)) {
    recordedDrift.push(`${entry.id} (${entry.finding}): ${entry.file} is gone — recorded for ${entry.consumer}`)
    continue
  }
  if (!readFileSync(path, 'utf8').includes(entry.anchor)) {
    recordedDrift.push(`${entry.id} (${entry.finding}): ${entry.file} no longer contains \`${entry.anchor}\` — recorded for ${entry.consumer}`)
  }
}
// Checks with no recorded anchor behind them: this is the set that stays fatal
// under --accept-recorded.
const drift = []

const packages = platformPackages()
const importedByPackage = new Map()
const familyServices = new Set()
const familyReads = new Set()
const PLATFORM_SCOPED = /^@deepseek-ai\/dsh-/
for (const name of readdirSync(familyRoot, { withFileTypes: true })) {
  if (!name.isDirectory() || !existsSync(join(familyRoot, name.name, 'package.json'))) continue
  walkSources(join(familyRoot, name.name, 'src'), (_path, text) => {
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      const source = match[2]
      if (!PLATFORM_SCOPED.test(source) || source.startsWith('@deepseek-ai/dsh-evolution') || source.startsWith('@deepseek-ai/dsh-memory') || source.startsWith('@deepseek-ai/dsh-skill-usage') || source.startsWith('@deepseek-ai/dsh-tool-')) continue
      const symbols = new Set()
      for (const part of match[1].split(',')) {
        const trimmed = part.trim().replace(/^type\s+/, '')
        if (trimmed === '' || trimmed.startsWith('*')) continue
        symbols.add((trimmed.split(/\s+as\s+/)[0] ?? trimmed).trim())
      }
      if (symbols.size === 0) continue
      const existing = importedByPackage.get(source) ?? new Set()
      for (const symbol of symbols) existing.add(symbol)
      importedByPackage.set(source, existing)
    }
    for (const match of text.matchAll(SERVICE_DECLARATION)) familyServices.add(match[1])
    for (const match of text.matchAll(/ctx\.get\('([^']+)'\)/g)) familyReads.add(match[1])
  })
}

let symbolChecks = 0
for (const [pkg, symbols] of importedByPackage) {
  const dir = packages.get(pkg)
  if (dir === undefined) {
    drift.push(`imported package ${pkg} does not exist in the platform tree`)
    continue
  }
  const exported = exportedNames(dir)
  for (const symbol of symbols) {
    symbolChecks += 1
    if (!exported.has(symbol)) drift.push(`${pkg} no longer exports \`${symbol}\` (imported by the family)`)
  }
}

const providedServices = new Set(familyServices)
walkSources(join(upstream, 'packages'), (_path, text) => {
  for (const match of text.matchAll(SERVICE_DECLARATION)) providedServices.add(match[1])
})

let serviceChecks = 0
for (const name of familyReads) {
  serviceChecks += 1
  if (!providedServices.has(name)) drift.push(`service \`${name}\` (read through ctx.get) is provided by neither the family nor the platform`)
}

// G5.1: the family's prompt-section orders must sort AFTER every first-party
// section on the target line. The platform exposes its scale as SECTION_ORDERS;
// when that table exists, every entry must stay below the family's minimum.
const constants = readFileSync(join(familyRoot, 'evolution-core', 'src', 'constants.ts'), 'utf8')
const familyOrders = [...constants.matchAll(/^export const ([A-Z_]*SECTION_ORDER) = (\d+)$/gm)]
  .map(match => ({ name: match[1], value: Number(match[2]) }))
if (familyOrders.length === 0) drift.push('evolution-core/src/constants.ts declares no *_SECTION_ORDER constant — the section-order window cannot be checked')
const sectionOrderPath = join(upstream, 'packages', 'core', 'system-prompt', 'src', 'index.ts')
if (existsSync(sectionOrderPath)) {
  const text = readFileSync(sectionOrderPath, 'utf8')
  const table = /const SECTION_ORDERS = \{([\s\S]*?)\n\}/.exec(text)
  if (table === null) {
    console.log('verify-platform-contract: platform has no SECTION_ORDERS table on this line — literal section orders predate the named scale, no window check')
  } else {
    const platformOrders = [...table[1].matchAll(/([A-Z_]+):\s*(\d+)/g)].map(match => ({ name: match[1], value: Number(match[2]) }))
    const highest = platformOrders.reduce((best, item) => (item.value > best.value ? item : best), { name: '(none)', value: Number.NEGATIVE_INFINITY })
    const lowestFamily = familyOrders.reduce((best, item) => (item.value < best.value ? item : best), { name: '(none)', value: Number.POSITIVE_INFINITY })
    console.log(`verify-platform-contract: section order scale — platform highest ${highest.name}=${highest.value}; family lowest ${lowestFamily.name}=${lowestFamily.value}`)
    for (const item of familyOrders) {
      if (item.value <= highest.value) {
        drift.push(`${item.name}=${item.value} does not sort after the platform's highest first-party section ${highest.name}=${highest.value} — the section would render before the tool guidance`)
      }
    }
  }
}

console.log(`verify-platform-contract: checked ${CONTRACT_ANCHORS.length} recorded anchor(s), ${symbolChecks} imported symbol(s), ${serviceChecks} service name(s) against ${upstream}`)
if (recordedDrift.length > 0) {
  const label = acceptRecorded
    ? 'accepted recorded difference(s) — each has a decision recorded in the anchor table'
    : 'recorded host-surface difference(s)'
  console.error(`verify-platform-contract: ${recordedDrift.length} ${label}:`)
  console.error(recordedDrift.join('\n'))
}
if (drift.length > 0) {
  console.error(`verify-platform-contract: ${drift.length} unrecorded host-surface difference(s):`)
  console.error(drift.join('\n'))
  console.error('verify-platform-contract: this is the upgrade diff — decide per difference (see docs/upstream-contract-checklist.md), then record it in the anchor table of this script.')
  process.exit(1)
}
if (recordedDrift.length > 0 && !acceptRecorded) {
  console.error('verify-platform-contract: pass --accept-recorded to treat those recorded differences as the decided upgrade diff (the CI mode).')
  process.exit(1)
}
console.log(recordedDrift.length > 0
  ? `verify-platform-contract: OK — ${recordedDrift.length} recorded difference(s), all accounted for by the anchor table; no unrecorded drift`
  : 'verify-platform-contract: OK — the recorded host surface is unchanged')
