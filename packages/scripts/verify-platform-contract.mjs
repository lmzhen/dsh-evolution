#!/usr/bin/env node
/**
 * Platform-contract probe (v33 G4.2): given a platform checkout, report every
 * place the family's host surface has moved.
 *
 * Four checks, all read-only and all mechanical:
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
 *   4. Platform anchors (v42 G2) — every platform path the family cites, in the
 *      `platform:<pkg>/<file>:<line>` convention or as a bare citation, must name a
 *      path that exists under `--upstream` with every cited line inside it. The
 *      SEMANTIC_ASSERTIONS table judges what a text-presence check cannot see: a
 *      disabled patch item, a doc line a consumer rests on, a format version.
 *      Both are RECORDED drift — `--accept-recorded` tolerates them alone.
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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

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
    consumer: 'none — a waterfall, not the durable vocabulary; the family folds the DURABLE PTC pair (tool/ptc-dispatch-start + tool/ptc-dispatch) through evolution-core/src/tool-dispatch.ts',
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
    // v33 recorded 3 (the 0.1.5 line); the 0.2.x line is 4 and ships the released v3→v4
    // migration (`packages/session/session-format-v3-to-v4`), so the family's fixtures write v4.
    anchor: 'export const SESSION_FORMAT_VERSION = 4',
    consumer: 'evolution-review persistence fixtures (v4 headers; the v3 logs they used to write are migrated on read)',
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
    id: 'dispatch-result-seam',
    file: 'packages/core/tools/src/index.ts',
    anchor: "'tools/result'(this: Scoped<ToolRuntime>",
    consumer: 'none yet — the modality-free seam the rootfix P6 probe identified (2026-09-14): it fires for every execution that reaches a final result, native and PTC alike, with exec.parent set on a nested dispatch. The family still folds the durable log, so this anchor exists to make a rename visible BEFORE a consumer lands.',
    finding: 'v41 §C (P6 probe)',
  },
  {
    id: 'dispatch-result-seam-emit',
    file: 'packages/core/tools/src/index.ts',
    anchor: "'tools/result', exec, result,",
    consumer: 'the seam ONE emission site (registry), recorded as the chokepoint a modality-blind consumer would hang on',
    finding: 'v41 §C (P6 probe)',
  },
  {
    id: 'persona-order-literal',
    file: 'packages/core/system-prompt/src/index.ts',
    anchor: 'DEPLOYMENT_PERSONA_SUFFIX: 10200,',
    consumer: 'the family guidance sections (orders 11000/11100) must stay above this ceiling',
    finding: 'P1-3',
  },
  {
    id: 'context-orders-map',
    file: 'packages/core/system-prompt/src/index.ts',
    anchor: 'const CONTEXT_ORDERS = {',
    consumer: 'the runtime-context position map (PromptContextOrderName) a family context entry is placed by — a renamed or removed map silently re-places every context entry the family registers',
    finding: '6-4 (A71)',
  },
  {
    id: 'skill-root-dsh-home',
    file: 'packages/skill/skill-filesystem/src/index.ts',
    anchor: 'dshHome: z.string(),',
    consumer: 'the family root resolution mirrors this key\u2019s semantics (S6.4/A6): a rename drops the family\u2019s parity with the platform skill roots',
    finding: '1-3 (A6)',
  },
  {
    id: 'skill-root-agents-home',
    file: 'packages/skill/skill-filesystem/src/index.ts',
    anchor: 'agentsHome: z.string(),',
    consumer: 'the family root resolution mirrors this key\u2019s semantics (S6.4/A6): a rename drops the family\u2019s parity with the platform skill roots',
    finding: '1-3 (A6)',
  },
  {
    id: 'skill-root-include-default-roots',
    file: 'packages/skill/skill-filesystem/src/index.ts',
    anchor: 'includeDefaultRoots: z.boolean().default(true),',
    consumer: 'the family root resolution mirrors this switch (S6.4/A4): with false the platform serves a root set the family must not assume',
    finding: '1-3 (A6)',
  },
  {
    id: 'skill-root-custom-dirs',
    file: 'packages/skill/skill-filesystem/src/index.ts',
    anchor: 'customSkillDirs: z.array(z.string()).default([]),',
    consumer: 'the family root resolution mirrors this list (S6.4/A5): a rename drops the family\u2019s parity with the platform skill roots',
    finding: '1-3 (A6)',
  },
  {
    id: 'agent-inbox-surface',
    file: 'packages/core/agent/src/runtime-types.ts',
    anchor: 'export interface Inbox {',
    consumer: 'evolution-review\'s soft inbox probe (InboxLike) — the pending-message queue its notice state machine tracks; the view is deliberately minimal/optional (A72)',
    finding: '6-5 (A72)',
  },
  {
    id: 'subagent-start-request',
    file: 'packages/subagent/subagent/src/types.ts',
    anchor: 'export interface SubagentStartRequest {',
    consumer: 'evolution-review and evolution-maintenance soft subagent probes (their SubagentStartRequestLike views; neither package declares @deepseek-ai/dsh-subagent, and the request a probe may omit fields from is the reason the view stays minimal) — A72',
    finding: '6-5 (A72)',
  },
  {
    id: 'subagent-result',
    file: 'packages/subagent/subagent/src/types.ts',
    anchor: 'export interface SubagentResult {',
    consumer: 'the same two packages\u2019 SubagentResultLike views (output / structured / stopReason are the fields they read) — A72',
    finding: '6-5 (A72)',
  },
  {
    id: 'subagent-run',
    file: 'packages/subagent/subagent/src/types.ts',
    anchor: 'export interface SubagentRun {',
    consumer: 'evolution-maintenance\u2019s SubagentRunLike and evolution-review\u2019s SubagentLike (the disposable handle both await and dispose) — A72',
    finding: '6-5 (A72)',
  },
  {
    id: 'approval-policy-values',
    file: 'packages/interaction/user-approval/src/index.ts',
    anchor: "export type ApprovalPolicy = 'ask' | 'never'",
    consumer: 'evolution-approval\u2019s single-sourced ApprovalPolicyLike + effectiveSessionPolicy (N2 keeps the family copy in one place; this anchor is what makes a platform VALUE change visible) — A72',
    finding: '6-5 (A72)',
  },
  {
    id: 'profile-context-surface',
    file: 'packages/boot/app-boot/src/profile-context.ts',
    anchor: 'export interface ProfileContext {',
    consumer: 'evolution-commands\u2019 ProfileContextLike (preset install reads the profile name/dir/patchPath to write its row) — A72',
    finding: '6-5 (A72)',
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
  {
    id: 'schemastery-volatile',
    file: 'vendor/schemastery/src/index.ts',
    anchor: 'Schema.prototype.volatile = function volatile() {',
    consumer: 'every family row Config: `.volatile()` is what makes a field user-writable (G1); the vendored 3.18.2 on the older line has no such method',
    finding: 'G1 / S2',
  },
  {
    id: 'settings-volatile-surface-rule',
    file: 'packages/settings/settings/src/index.ts',
    anchor: 'const form = volatileForm(schema)',
    consumer: 'the parameter surface itself: a row whose schema declares no volatile field is SKIPPED by describe(), so a row without `.volatile()` has no writable parameter face (G1)',
    finding: 'G1 / D2',
  },
  {
    id: 'settings-service-name',
    file: 'packages/settings/settings/src/index.ts',
    anchor: "super(ownerContext, 'settings')",
    consumer: "the G1 write path (`settings.update(ns, patch)`) and the service detector in this script — the owner receiver is not `ctx`, which is why the old regex reported `settings` missing",
    finding: 'G1 / D2',
  },
  {
    id: 'config-editor-service-name',
    file: 'packages/boot/config-editor/src/index.ts',
    anchor: "super(ownerContext, 'configEditor')",
    consumer: 'user-layer reads: `configuration()` gives { entry, inherited, override } for the G3 migration and the G5 diagnostics; namespace === row id',
    finding: 'G3 / G5',
  },
  {
    id: 'plugin-inventory-read',
    file: 'packages/host/plugin-inventory/src/index.ts',
    anchor: 'export async function readPluginInventory(ctx: Context): Promise<PluginInventorySnapshot> {',
    consumer: 'the G5 diagnostics read surface: per-entry enabled/fiberPhase and the agentPresets roster with its own `broken` verdict',
    finding: 'G5',
  },
  {
    id: 'plugin-row-config-slot',
    file: 'packages/client/ui-plugin-manager/src/client/index.ts',
    anchor: "'plugins.row.config': { kind: 'keyed', scope: 'root' },",
    consumer: 'the G2 client seat: a keyed root slot the Plugins page renders per row (`summary` and `page` views)',
    finding: 'G2',
  },
  {
    id: 'plugin-row-config-key',
    file: 'packages/client/ui-plugin-manager/src/client/config-ledger.ts',
    anchor: 'export function rowConfigKey(bundle: string, rowId: string): string {',
    consumer: 'the exact key the family registers its per-row parameter form under (`<bundle>#<rowId>`)',
    finding: 'G2',
  },
  {
    id: 'config-forms-client-service',
    file: 'packages/client/ui-settings/src/client/config-form.ts',
    anchor: 'configForms: ConfigForms',
    consumer: 'the G2 client seam: `ctx.get(\'configForms\')` is the optional probe that replaced the removed `settingsScope`; injecting it when absent would leave the entry pending and fail the all-or-nothing client boot',
    finding: 'G2 / D1',
  },
]

/** Directories never worth scanning for platform facts. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'dist', 'tests', 'coverage', '.release-staging'])

/** Both shapes a Cordis service registration takes: a `Service` subclass
 * (`super(ctx, 'name')`) and a plain `ctx.provide('name', value)`. */
// The receiver of `super(...)` is not always called `ctx` (0.2.x's SettingsForms does
// `super(ownerContext, 'settings')`), and a detector that only recognized `ctx` reported a
// platform-provided service as missing. Any identifier/qualified name is accepted.
const SERVICE_DECLARATION = /(?:super\(\s*[A-Za-z_$][\w$.]*\s*,\s*|\.provide\()'([^']+)'/g

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

/**
 * The durable dispatch vocabularies the family READS and the platform write
 * sites that produce them (rootfix P6 probe, re-measured 2026-09-14).
 *
 * The family's accounting hangs on these events, so the WRITER SET is itself a
 * contract, not an implementation detail: one vocabulary per mounted runtime
 * mode, exactly one write site each, and the registry — the one place every
 * modality passes through — writing no durable dispatch event at all. A second
 * writer, a moved site or a third vocabulary is a silent-accounting change: the
 * family keeps folding what it was taught and never learns the modality it was
 * not (the v37 P7a incident: PTC sessions credited zero skill reads). Arch guard
 * N11 keeps a second reader from matching a vocabulary directly; this table
 * keeps the writer side visible. `sites` is the recorded occurrence count.
 */
const DISPATCH_WRITE_SITES = [
  {
    id: 'native-call',
    file: 'packages/core/agent-loop/src/tool-calls.ts',
    needle: "append('tool/call'",
    sites: 1,
    owner: 'the agent loop is the ONLY writer of the native call vocabulary',
  },
  {
    id: 'native-result',
    file: 'packages/core/agent-loop/src/tool-calls.ts',
    needle: "append('tool/result'",
    sites: 1,
    owner: 'the agent loop settles the native call it opened',
  },
  {
    id: 'ptc-dispatch-start',
    file: 'packages/core/tools/src/ptc.ts',
    needle: "append('tool/ptc-dispatch-start'",
    sites: 1,
    owner: 'the PTC bridge opens one durable record per sub-dispatch',
  },
  {
    id: 'ptc-dispatch-settle',
    file: 'packages/core/tools/src/ptc.ts',
    needle: "append('tool/ptc-dispatch'",
    sites: 1,
    owner: 'and settles the same record (the family folds the pair into ONE dispatch)',
  },
  {
    id: 'registry-writes-none',
    file: 'packages/core/tools/src/index.ts',
    needle: "append('tool/call'",
    sites: 0,
    owner: 'the registry writes NO durable dispatch event for a model-direct call — the structural hole that makes the native vocabulary the agent loop business alone',
  },
]

/**
 * The platform's top-level vocabulary at the 0.1.5-rc.2 line: every
 * `packages/<group>` name plus the group-omitted leaf names the family cites in
 * bare form. The recognizer never reads the tree it audits to decide what to
 * read, so an empty upstream names citations instead of scanning none.
 */
const PLATFORM_ROOTS = new Set(('acp api attachment boot bundle client code-runtime compaction context core credentials e2b evolution ' +
  'experimental extensions feedback fs goal guard hooks host identity interaction jobs llm lsp mcp plan preset runtime-diagnostics ' +
  'sandbox schedule sdk session session-query settings shell skill spill storage subagent subprocess terminal test-support todo ' +
  'typert util web webhook workflow workspace agent-loop app-boot skill-filesystem storage-json subagent-spawn-in-process').split(' '))

/**
 * A citation in either shape the family writes: the `platform:` convention or the
 * bare path, each ending in a source extension (with an optional `:LINE` or
 * `:LINE-LINE`) or in a directory slash.
 */
const PLATFORM_CITATION = /(platform:)?((?:[A-Za-z0-9_@.-]+\/)+(?:[A-Za-z0-9_.*-]+\.(?:tsx|ts|mts|cts|mjs|cjs|json|yaml|yml|md|css|html|py|sh|js)|[A-Za-z0-9_.*-]*\/))(?::(\d+)(?:-(\d+))?)?/g

/**
 * Facts a text-presence anchor cannot see, each judged from the file's own
 * structure — a patch item from its own block, the scope doc line from the
 * signature it documents — so no line number is hardcoded. A break is recorded
 * drift like an anchor, and the shipped mode stays fatal for it.
 */
const SEMANTIC_ASSERTIONS = [
  {
    id: 'web-app-disables-tool-skill',
    file: 'packages/bundle/web-app/cordis.patch.yml',
    kind: 'patch-item-disabled',
    item: 'tool-skill',
    consumer: 'the web plane must not mount the host-plane skill tool the family bundles its own skill reads for',
    finding: 'P2-A2',
  },
  {
    id: 'web-app-disables-skill-filesystem',
    file: 'packages/bundle/web-app/cordis.patch.yml',
    kind: 'patch-item-disabled',
    item: 'skill-filesystem',
    consumer: 'the web plane must not mount the platform skill filesystem the family catalog reads around',
    finding: 'P2-A2',
  },
  {
    id: 'web-app-disables-command-goal',
    file: 'packages/bundle/web-app/cordis.patch.yml',
    kind: 'patch-item-disabled',
    item: 'command-goal',
    consumer: 'the goal command stays on the host plane; the family command plane owns the human command',
    finding: 'P2-D2',
  },
  {
    id: 'tools-get-scope-doc',
    file: 'packages/core/tools/src/index.ts',
    kind: 'doc-line',
    signature: 'get(name: string, scope?: ScopeKey)',
    doc: '@param scope',
    anchor: 'omitted = the global view',
    consumer: 'evolution-core/src/scope.ts and the N16 callingScope gate: an omitted scope IS the global view',
    finding: 'N16',
  },
  {
    id: 'session-format-version-is-4',
    file: 'packages/core/session/src/types.ts',
    kind: 'text',
    // The value, not just the declaration: a format bump with the same text would still change
    // what a persisted family log means, so the version is recorded as its own anchor.
    anchor: 'export const SESSION_FORMAT_VERSION = 4',
    consumer: 'evolution-review persistence fixtures (v4 headers)',
    finding: 'P2-B1',
  },
  {
    id: 'known-tool-event-vocabulary',
    file: 'packages/core/session/src/known-event-types.ts',
    kind: 'quoted-list',
    items: ['tool/call', 'tool/result', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch'],
    consumer: 'evolution-core/src/tool-dispatch.ts folds the native pair and the durable PTC pair from this list',
    finding: 'P2-A2',
  },
]

/** Directories never worth scanning at the platform-anchor surface. */
const CITATION_SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'dist', '.next'])

/**
 * Walk the family tree and hand every non-excluded, non-binary file to `visit`;
 * citations live in comments, docs and manifests as often as in `.ts` sources.
 * @param dir - directory to walk.
 * @param visit - called with the absolute path and the file content.
 */
function walkCitationSurface(dir, visit) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (CITATION_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.release-staging')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkCitationSurface(path, visit)
      continue
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    const text = readFileSync(path, 'utf8')
    if (text.includes('\u0000')) continue
    visit(path, text)
  }
}

const GLOB_CHARS = /[.*+?^$()|[\]\\]/g

/**
 * @param pattern - a path segment that may contain `*`.
 * @param name - the directory entry name to test.
 * @returns whether the segment matches the name.
 */
function globSegment(pattern, name) {
  return new RegExp('^' + pattern.split('*').map(part => part.replace(GLOB_CHARS, '\\$&')).join('.*') + '$').test(name)
}

/**
 * Resolve a cited path under `base`, expanding `*` segments (the family's glob and
 * directory citations) instead of reading them as literal names.
 * @param base - the directory the cited path is relative to.
 * @param rel - the cited path, with `/` separators and optional `*` segments.
 */
function resolveCitation(base, rel) {
  let dirs = [base]
  for (const part of rel.split('/')) {
    if (part === '') continue
    const next = []
    for (const dir of dirs) {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue
        if (part.includes('*') ? globSegment(part, entry.name) : entry.name === part) next.push(join(dir, entry.name))
      }
    }
    dirs = next
    if (dirs.length === 0) return ''
  }
  return dirs[0] ?? ''
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
// The writer set, measured rather than assumed. A drift here is recorded like an
// anchor (--accept-recorded tolerates it) but named with its count, because a
// second write site and a moved one are the same event for the family: the
// ledger it folds no longer describes every dispatch.
const writeSiteChecks = DISPATCH_WRITE_SITES.length
for (const entry of DISPATCH_WRITE_SITES) {
  const path = join(upstream, entry.file)
  if (!existsSync(path)) {
    recordedDrift.push(`${entry.id}: ${entry.file} is gone — ${entry.owner}`)
    continue
  }
  const sites = readFileSync(path, 'utf8').split(entry.needle).length - 1
  if (sites !== entry.sites) {
    recordedDrift.push(`${entry.id}: ${entry.file} now contains ${sites} occurrence(s) of \`${entry.needle}\`, recorded ${entry.sites} — ${entry.owner}`)
  }
}
// Checks with no recorded anchor behind them: this is the set that stays fatal
// under --accept-recorded.
const drift = []

// Red line 13 (checklist item 18): the installer's `PROFILE_SEED_TEMPLATES` is a
// hand-copied snapshot of the platform's `PROFILE_TEMPLATES` and of the manifest
// `initProfile` writes, taken because the installer runs before any profile
// exists. A text anchor cannot see a template name, a bundle list or a seed field
// move; the 0.1.5 copy that stored `patchReload` was exactly the drift a presence
// anchor misses, so both tables are compared name by name and the seed's fields
// key by key.
const PLATFORM_PROFILE_SOURCE = 'packages/boot/app-boot/src/profile.ts'
const FAMILY_INSTALLER_SOURCE = 'scripts/install-layered.mjs'

/**
 * Drop line and block comments, skipping quoted strings, so a scan can read the
 * code alone: an apostrophe inside a comment (\`platform's\`) otherwise reads as an
 * unterminated string and unbalances the brace walk below.
 * @param text - the source text to read.
 * @returns the same text with its comments removed.
 */
function stripComments(text) {
  let out = ''
  let quote = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== '') {
      out += char
      if (char === quote && text[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      out += char
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      out += '\n'
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 1
      continue
    }
    out += char
  }
  return out
}

/**
 * The text inside the brace-delimited literal that `marker` opens, braces
 * excluded. Call it on {@link stripComments} output.
 * @param text - the source text to read.
 * @param marker - the literal that precedes the opening brace.
 * @returns the literal's body, or null when the marker or its brace is missing.
 */
function literalBody(text, marker) {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const start = text.indexOf('{', at + marker.length)
  if (start < 0) return null
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start + 1, index)
    }
  }
  return null
}
/**
 * The keys declared at an object literal's outermost level: those at the body's
 * own minimum indentation, so a nested literal's keys stay out of the set.
 * @param body - the literal's text, braces excluded.
 * @returns the key names in source order.
 */
function topLevelKeys(body) {
  const rows = [...body.matchAll(/^([ \t]+)([A-Za-z_$][\w$]*):/gm)]
  if (rows.length === 0) return []
  const indent = Math.min(...rows.map(row => row[1].length))
  return rows.filter(row => row[1].length === indent).map(row => row[2])
}

/**
 * The keys written inside a literal body, inline or one per line.
 * @param body - the literal's text, braces excluded.
 * @returns the key names in source order.
 */
function inlineKeys(body) {
  return [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(match => match[1])
}

/**
 * One template entry per name, read from a table's own literal: the entry's key
 * names and its `bundles` list.
 * @param text - the source text holding the table.
 * @param marker - the literal that opens the table.
 * @returns template name to `{ keys, bundles }`, or null when the table is not there.
 */
function bundleTable(text, marker) {
  const body = literalBody(text, marker)
  if (body === null) return null
  const table = new Map()
  for (const match of body.matchAll(/(?:^|\n)\s*(?:'([\w-]+)'|([\w-]+)):\s*\{([^}]*)\}/g)) {
    const entry = match[3]
    table.set(match[1] ?? match[2], {
      keys: inlineKeys(entry),
      bundles: [...(/bundles:\s*\[([^\]]*)\]/.exec(entry)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(item => item[1]),
    })
  }
  return table
}

let seedSnapshotChecks = 0
const platformProfilePath = join(upstream, ...PLATFORM_PROFILE_SOURCE.split('/'))
const familyInstallerPath = join(familyRoot, ...FAMILY_INSTALLER_SOURCE.split('/'))
if (!existsSync(platformProfilePath) || !existsSync(familyInstallerPath)) {
  drift.push(`the installer's profile seed snapshot cannot be compared: ${PLATFORM_PROFILE_SOURCE} or ${FAMILY_INSTALLER_SOURCE} is missing from the tree pair`)
} else {
  const platformProfileText = stripComments(readFileSync(platformProfilePath, 'utf8'))
  const familyInstallerText = stripComments(readFileSync(familyInstallerPath, 'utf8'))
  const platformTemplates = bundleTable(platformProfileText, 'export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = ')
  const familyTemplates = bundleTable(familyInstallerText, 'const PROFILE_SEED_TEMPLATES = ')
  if (platformTemplates === null || familyTemplates === null) {
    drift.push('the profile template table moved: PROFILE_TEMPLATES (platform) or PROFILE_SEED_TEMPLATES (installer) is no longer a literal table of `bundles` lists')
  } else {
    seedSnapshotChecks += platformTemplates.size
    for (const [name, template] of platformTemplates) {
      const copy = familyTemplates.get(name)
      if (copy === undefined) {
        drift.push(`platform profile template \`${name}\` ([${template.bundles.join(', ')}]) is missing from the installer's PROFILE_SEED_TEMPLATES`)
        continue
      }
      if (copy.bundles.join(', ') !== template.bundles.join(', ')) {
        drift.push(`profile template \`${name}\` bundles drifted: platform [${template.bundles.join(', ')}] vs installer [${copy.bundles.join(', ')}]`)
      }
      if (copy.keys.join(', ') !== template.keys.join(', ')) {
        const extra = copy.keys.filter(key => !template.keys.includes(key))
        const absent = template.keys.filter(key => !copy.keys.includes(key))
        drift.push(`profile template \`${name}\` fields drifted: platform {${template.keys.join(', ')}} vs installer {${copy.keys.join(', ')}}`
          + (extra.length > 0 ? ` — the installer stores ${extra.join(', ')}, which the platform template does not declare` : '')
          + (absent.length > 0 ? ` — the installer omits ${absent.join(', ')}` : ''))
      }
    }
    for (const name of familyTemplates.keys()) {
      if (!platformTemplates.has(name)) drift.push(`installer profile template \`${name}\` does not exist on the platform — a self-created \`${name}\` profile would seed a bundle list this line does not ship`)
    }
  }
  seedSnapshotChecks += 1
  const platformDefault = /export const DEFAULT_PROFILE_BUNDLES[^=]*=\s*\[([^\]]*)\]/.exec(platformProfileText)
  const familyDefault = /const DEFAULT_SEED_TEMPLATE = \{\s*bundles:\s*\[([^\]]*)\]/.exec(familyInstallerText)
  const platformDefaultBundles = platformDefault === null ? [] : [...platformDefault[1].matchAll(/'([^']+)'/g)].map(item => item[1])
  const familyDefaultBundles = familyDefault === null ? [] : [...familyDefault[1].matchAll(/'([^']+)'/g)].map(item => item[1])
  if (platformDefaultBundles.length === 0 || familyDefaultBundles.length === 0) {
    drift.push('the default profile bundles moved: DEFAULT_PROFILE_BUNDLES (platform) or DEFAULT_SEED_TEMPLATE (installer) is no longer a literal bundle list')
  } else if (platformDefaultBundles.join(', ') !== familyDefaultBundles.join(', ')) {
    drift.push(`the default profile bundles drifted: platform [${platformDefaultBundles.join(', ')}] vs installer [${familyDefaultBundles.join(', ')}]`)
  }
  seedSnapshotChecks += 1
  const platformSeed = literalBody(platformProfileText, 'const manifest: ProfileManifest & { private: boolean } = ')
  const familySeed = literalBody(familyInstallerText, 'await writeManifestAtomic(manifestPath, JSON.stringify(')
  if (platformSeed === null || familySeed === null) {
    drift.push('the profile seed write moved: initProfile (platform) or ensureProfile (installer) no longer writes a literal manifest')
  } else {
    const platformKeys = topLevelKeys(platformSeed)
    const familyKeys = topLevelKeys(familySeed)
    if (platformKeys.join(', ') !== familyKeys.join(', ')) {
      drift.push(`the seeded profile manifest key set drifted: initProfile writes {${platformKeys.join(', ')}} vs the installer's {${familyKeys.join(', ')}}`)
    } else {
      const platformDsh = literalBody(platformSeed, 'dsh: ')
      const familyDsh = literalBody(familySeed, 'dsh: ')
      const profileKeysOf = (body) => {
        const profile = body === null ? null : literalBody(body, 'profile: ')
        return profile === null ? [] : inlineKeys(profile)
      }
      const platformProfileKeys = profileKeysOf(platformDsh)
      const familyProfileKeys = profileKeysOf(familyDsh)
      if (platformProfileKeys.join(', ') !== familyProfileKeys.join(', ')) {
        drift.push(`the seeded \`dsh.profile\` key set drifted: initProfile writes {${platformProfileKeys.join(', ')}} vs the installer's {${familyProfileKeys.join(', ')}} — a field the platform does not read is a snapshot it never honors`)
      }
    }
  }
  console.log(`verify-platform-contract: profile seed snapshot — ${seedSnapshotChecks} check(s) against ${PLATFORM_PROFILE_SOURCE} (template bundles, default bundles, manifest keys)`)
}

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

// G2 semantic assertions: judged from each file's own structure, never from a
// recorded line number. A patch item is the block opened by its `- id:` line, so a
// sibling row moving or a new row landing above it cannot fake the answer.
let semanticChecks = 0
for (const entry of SEMANTIC_ASSERTIONS) {
  semanticChecks += 1
  const path = join(upstream, entry.file)
  if (!existsSync(path)) {
    recordedDrift.push(entry.id + ': ' + entry.file + ' is gone — recorded for ' + entry.consumer)
    continue
  }
  const lines = readFileSync(path, 'utf8').split('\n')
  const text = lines.join('\n')
  if (entry.kind === 'patch-item-disabled') {
    const start = lines.findIndex(line => line.replace(/^\s*-\s*id:\s*/, '').trim() === entry.item && /^\s*-\s*id:\s*\S/.test(line))
    if (start < 0) {
      recordedDrift.push(entry.id + ': ' + entry.file + ' no longer lists the ' + entry.item + ' item — recorded for ' + entry.consumer)
      continue
    }
    let end = lines.length
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^\s*-\s*id:\s*\S/.test(lines[i])) {
        end = i
        break
      }
    }
    const disabled = lines.slice(start, end).some(line => !line.trimStart().startsWith('#') && /^\s*disabled:\s*true\s*$/.test(line))
    if (!disabled) {
      recordedDrift.push(entry.id + ': the ' + entry.item + ' item at ' + entry.file + ':' + (start + 1) + ' no longer carries `disabled: true` in its own block — recorded for ' + entry.consumer)
    }
    continue
  }
  if (entry.kind === 'doc-line') {
    const signature = lines.findIndex(line => line.includes(entry.signature))
    if (signature < 0) {
      recordedDrift.push(entry.id + ': ' + entry.file + ' no longer declares `' + entry.signature + '` — recorded for ' + entry.consumer)
      continue
    }
    const doc = lines.slice(Math.max(0, signature - 30), signature).reverse().find(line => line.includes(entry.doc))
    if (doc === undefined || !doc.includes(entry.anchor)) {
      recordedDrift.push(entry.id + ': the `' + entry.doc + '` line above ' + entry.file + ':' + (signature + 1) + ' no longer contains `' + entry.anchor + '` — recorded for ' + entry.consumer)
    }
    continue
  }
  if (entry.kind === 'quoted-list') {
    const missing = entry.items.filter(item => !new RegExp("['\"]" + item.replace(/[.*+?^$()|[\]\\/]/g, '\\$&') + "['\"]").test(text))
    if (missing.length > 0) {
      recordedDrift.push(entry.id + ': ' + entry.file + ' no longer lists ' + missing.join(', ') + ' — recorded for ' + entry.consumer)
    }
    continue
  }
  if (!text.includes(entry.anchor)) {
    recordedDrift.push(entry.id + ': ' + entry.file + ' no longer contains `' + entry.anchor + '` — recorded for ' + entry.consumer)
  }
}

// G2 platform anchors: every platform path the family cites must name a path
// that exists under --upstream with every cited line in bounds. Bare paths are
// tried as `packages/<path>`, as `<path>`, then through the group-omitted read
// the family's shorthand relies on (`llm/src/message.ts:258`, `storage-json/src/atomic.ts:24`).
const familyChildren = new Set(readdirSync(familyRoot, { withFileTypes: true }).map(entry => entry.name))
// Family-owned top-level paths in the MIRROR layout, recorded rather than
// probed: `packages/docs/` is gitignored (so a CI checkout has no
// `packages/evolution/docs` to probe, and the platform's OWN docs directory made
// the citation resolve by accident in the baseline job) and `packages/scripts/`
// is the family's guard tree. Without this list the family's citations to its
// own docs were read as platform anchors and reported broken against the
// released upstream tag — the 0.3.78 compat job (dsh-v0.1.1-rc.2) went red on
// three of them while the baseline job stayed green.
const FAMILY_OWNED_UNDER_PACKAGES = new Set(['docs', 'scripts'])
let citationChecks = 0
const citationFindings = []
walkCitationSurface(familyRoot, (path, text) => {
  for (const match of text.matchAll(PLATFORM_CITATION)) {
    const cited = match[2]
    const segments = cited.split('/')
    const head = segments[0]
    if (match[1] === undefined) {
      // Not a platform path: a relative or URL form, an elided illustration, a
      // family package, a mirror-layout family path, or a bare name outside
      // PLATFORM_ROOTS.
      if (text.startsWith('...', match.index + match[0].length)) continue
      if (cited.startsWith('.') || cited.startsWith('/') || cited.startsWith('@') || cited.includes('://')) continue
      if (familyChildren.has(head)) continue
      if (head === 'packages') {
        if (FAMILY_OWNED_UNDER_PACKAGES.has(segments[1] ?? '')) continue
        if (resolveCitation(familyRoot, segments.slice(1).join('/')) !== '') continue
      } else if (head !== 'apps' && !(segments.includes('src') && PLATFORM_ROOTS.has(head))) continue
    }
    citationChecks += 1
    const at = relative(familyRoot, path) + ':' + text.slice(0, match.index).split('\n').length
    const resolved = resolveCitation(join(upstream, 'packages'), cited) || resolveCitation(upstream, cited) || resolveCitation(join(upstream, 'packages'), '*/' + cited)
    if (resolved === '') {
      citationFindings.push(at + ': cites `' + cited + '`, which is missing under ' + upstream + ' (tried packages/<path>, <path>, packages/*/<path>)')
      continue
    }
    if (match[3] === undefined) continue
    const line = Math.max(Number(match[3]), match[4] === undefined ? 0 : Number(match[4]))
    if (!statSync(resolved).isFile()) {
      citationFindings.push(at + ': cites `' + cited + ':' + line + '`, which resolves to the directory ' + resolved + ' — the line cannot be in bounds')
      continue
    }
    const total = readFileSync(resolved, 'utf8').split('\n').length
    if (line > total) citationFindings.push(at + ': cites `' + cited + ':' + line + '`, but ' + resolved + ' has ' + total + ' line(s)')
  }
})
if (citationChecks === 0) {
  drift.push('the platform-citation scan recognized no citation in the family tree — a scan that reads nothing is a vacuum, not a pass')
}
for (const finding of citationFindings) recordedDrift.push('platform-citation ' + finding)

console.log(`verify-platform-contract: checked ${CONTRACT_ANCHORS.length} recorded anchor(s), ${writeSiteChecks} dispatch write site(s), ${seedSnapshotChecks} profile seed check(s), ${semanticChecks} semantic assertion(s), ${citationChecks} platform citation(s) (${citationFindings.length} broken), ${symbolChecks} imported symbol(s), ${serviceChecks} service name(s) against ${upstream}`)
if (recordedDrift.length > 0) {
  const label = acceptRecorded
    ? 'accepted recorded difference(s) — each is accounted for by the anchor, semantic-assertion or citation record'
    : 'recorded host-surface difference(s)'
  console.error(`verify-platform-contract: ${recordedDrift.length} ${label}:`)
  console.error(recordedDrift.join('\n'))
}
if (drift.length > 0) {
  console.error(`verify-platform-contract: ${drift.length} unrecorded host-surface difference(s):`)
  console.error(drift.join('\n'))
  console.error('verify-platform-contract: this is the upgrade diff — decide per difference (see docs/upstream-contract-checklist.md — a working-copy asset: it is gitignored, so a CI checkout has no copy), then record it in the anchor table of this script.')
  process.exit(1)
}
if (recordedDrift.length > 0 && !acceptRecorded) {
  console.error('verify-platform-contract: pass --accept-recorded to treat those recorded differences as the decided upgrade diff (the CI mode).')
  process.exit(1)
}
console.log(recordedDrift.length > 0
  ? `verify-platform-contract: OK — ${recordedDrift.length} recorded difference(s), all accounted for by the anchor table; no unrecorded drift (${semanticChecks} semantic assertion(s) checked, ${citationChecks} platform citation(s) resolved)`
  : `verify-platform-contract: OK — the recorded host surface is unchanged (${semanticChecks} semantic assertion(s) hold, ${citationChecks} platform citation(s) resolved)`)
