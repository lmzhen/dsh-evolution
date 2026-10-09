#!/usr/bin/env node
/**
 * G7.1 architecture guards: two zero-tolerance checks that keep the family
 * converging on its single-source contracts.
 *   N1. `process.env.DSH_HOME` may only appear in evolution-core/src — every
 *       other package must route DSH_HOME through core's home resolver, so the
 *       directory never drifts between producers.
 *   N2. `ApprovalPolicyLike` / `effectiveSessionPolicy` are single-sourced in
 *       the approval package (0.3.22 G4.8; previously evolution-core) — a local
 *       copy anywhere else is a drift that will silently diverge from the
 *       contract.
 *   N3. every Config numeric field carries a value clamp (`.min(`/`.max(`/
 *       `.finite(`/`.nonnegative(`): schemastery lets NaN and ±Infinity through a
 *       bare `z.number()`, and the assembly-time clampedNumber() fallback is the
 *       authoritative guard (G3.1). Field-level single-line heuristic.
 *   H2. a probed `evolution[A-Z]\w+` service key must have a provider SOMEWHERE
 *       in the tree: doctor probed `evolutionReview` for five releases with zero
 *       providers and the self-check silently lied (P0-1 class).
 *   N5. `evolution-core` is the kernel: it must not import any other family
 *       package except the L0 seams (state-storage, memory). Dependency
 *       closure owns the full graph; this is the reverse-direction tripwire.
 *   N6. composition bundles (host/all/preset/agent) carry no runtime code —
 *       their substance is the manifest's YAML rows, so every src module
 *       must reduce to imports / re-exports / `export {}`.
 *   N7. `new SkillLibrary(...)` must route through core's newSkillLibrary()
 *       helper so root/limits parsing stays single-sourced (S3.1). Landed in
 *       0.3.75 (v41 P2-26): all 11 pre-v39 sites went through the helper and
 *       SKILL_LIBRARY_TODO is EMPTY — the rule now bites any new direct
 *       construction. Keep it empty: a new exception is a new divergence.
 *   N9. the S0.4 invariant (the obfuscation splitter must be a superset of
 *       the format-control detector) is structural: both derive from
 *       FORMAT_CONTROL_CLASS in threats.ts. A hand-written second class is
 *       the one way it can silently fork, so any `new RegExp(`[...]`)` class
 *       mentioning \p{Cf} must be built from that constant.
 *   N10. a NEW `ctx.get('<platform service>')` probe must come with a
 *       platform-declaration anchor in the same file (the pre-v39 counts are
 *       the baseline map; files already mentioning the platform pass). And
 *       (N10b, S3.4/A99) every probed service must be DECLARED in core's
 *       `PLATFORM_SERVICE_PROBES` — the table `/evolution doctor` judges capability
 *       absence from — with every declared entry still probed. The O-2 gap was
 *       doctor covering 6 of 26 probes: an absent capability was a silent
 *       downgrade nobody could see, and a new probe would have stayed invisible.
 *   N11. the platform's dispatch event types (`tool/call`, `tool/result`,
 *       `tool/ptc-dispatch-start`, `tool/ptc-dispatch`) are matched in exactly
 *       ONE module — `evolution-core/src/tool-dispatch.ts`. The platform writes
 *       ONE vocabulary per dispatch according to the mounted runtime mode
 *       (native vs PTC), so a second matcher is by construction blind to the
 *       other mode while looking correct; every consumer matches
 *       `ToolDispatchSignal.kind` instead. Comments and string literals are
 *       inert (the check strips them), so prose may name the types, and test
 *       files may CONSTRUCT them as fixtures (DISPATCH_GUARD_TEST_SUFFIXES).
 *       Only the literal and the core constants count as a match.
 *   N8. No package publishes a `./invariant` companion (v37 S2.1 / I-3): the
 *       platform auto-assembles nothing, so a companion nobody mounts is a
 *       dead channel — and the family mounts zero `<pkg>/invariant` rows.
 *   N12. module-scope MUTABLE process state (a `const X = new Set|Map|WeakMap`
 *       the file itself writes) must be registered with four facts: the platform
 *       gap it compensates for, its lifecycle owner functions, a test anchor,
 *       and its validity domain (single-process today). The platform exposes no
 *       per-turn attribution and no per-session warn channel, so the family
 *       keeps process-local state — the rule forces each such store to name its
 *       gap and its exit condition instead of growing silently.
 *   N13a. a must-execute payload may not ride the NON-waking primitive: an
 *       `agent.inject(msg)` call is registered with the `deliverEnsuringWake`
 *       debt (followup -> steer -> typed failure). `ctx.inject([deps], cb)` is
 *       cordis DI, not delivery, and is inert here.
 *   N13b. a wake primitive (`followup`/`steer`) may not be read into a local
 *       before being called: the platform Agent methods are PROTOTYPE methods
 *       that call `this.send(...)`, so a detached reference throws and the
 *       delivery vanishes while the caller still counts the segment as served
 *       (0.3.73: six days of silently eaten review prompts).
 *   N14. a `catch` that serves a durable-read failure as `absent` must be
 *       registered: read failure and "nothing is there" are different states
 *       (the read three-state discipline); each entry names its migration path.
 *       0.3.78 (B3): the four registered debts landed on probeList/probeMtime
 *       (evolution-core/src/probe.ts) and SWALLOW_CATCH is EMPTY — the rule now
 *       bites only NEW two-state reads.
 *   N15. a family code anchor (`evolution-core/src/x.ts:42`, and since v46 S2.7 also the bare
 *       `file.mjs:42` form when the basename is unique) must resolve in EVERY citation surface —
 *       Markdown, script comments and source comments:
 *       the file exists and the cited line is inside it. Prose that cites code
 *       cannot fail a build, so a moved/renamed/deleted symbol leaves the
 *       document describing a tree that no longer exists — audit-v37's
 *       `core/io.ts:475-481` conclusion survived two audit rounds that way.
 *       Family-relative `<pkg>/<file>` is the single-src shorthand; platform
 *       anchors (upstream paths) are out of scope — verify-platform-contract
 *       owns the recorded platform anchors.
 *   N16. a platform REGISTRY read that a decision depends on must be asked in
 *       the calling scope: `skills.list()` documents its `scope` as the calling
 *       agent with "OMITTED READS THE GLOBAL LAYER ALONE"
 *       (skill/skill/src/index.ts:113-120) and `tools.get(name)` resolves the
 *       same way (core/tools/src/index.ts:1194 — the method never reads
 *       this.ctx). A preset-mounted family row lives in its preset's standing
 *       scope, so a scope-less read calls a healthy tree "empty"/"missing" —
 *       that is the whole asymmetry between "evolution mounted onto the
 *       original preset" and the evolution variant preset. Route the read
 *       through callingScope(ctx); a DELIBERATE global-layer read (diagnostics
 *       only) is registered in SCOPE_READ_REGISTER with its reason.
 *   N17. modality-BLIND accounting: `ToolDispatchSignal.kind` may be
 *       discriminated only where the counting unit itself is defined —
 *       `evolution-core/src/signals.ts` splits a program's sub-dispatches from
 *       model-facing calls so that one 50-operation program does not advance the
 *       review cadence by 50 turns. Every other consumer reads the record's
 *       NAMES and COUNTS and never asks how the platform delivered it: the
 *       per-modality branch is exactly how PTC accounting went blind while the
 *       code still looked correct (v37 P7a), and route/dedup is the normalizer's
 *       job. A deliberate exception is registered in MODALITY_BRANCH_REGISTER
 *       with its reason.
 *   N18. a family consumer that subscribes to the platform's SESSION-scoped
 *       stream must consult the opt-in gate (evolution-core/src/opt-in.ts). In
 *       the variant install form the family's model rows live inside a variant
 *       preset, so a session running a platform ORIGINAL preset never opted in:
 *       a listener on `session/event` that never asks `sessionAudited` acts on
 *       sessions the family was never mounted into — the 0.3.77 C-axis class
 *       (review injected prompts into original-preset sessions and skill-usage
 *       counted their reads). The gate is
 *       `sessionAudited(ctx, session.id, config.sessionScoped)` (each row's own
 *       sessionScoped field); a deliberate exception is registered in
 *       SESSION_GATE_REGISTER with its reason. Comments are inert (stripped), so
 *       prose may name the stream; a string literal is not — the subscription
 *       literal is the signal (N17's posture).
 *   N19. one home per family fact: scripts/family-facts.json names the ONE
 *       document that states each cross-file fact, every other document cites it
 *       (a second copy fails), and the machine owners re-derive the values, so a
 *       stale number or a denied base fails with the value that moved.
 *   N20. the persisted-write inventory must match the code it describes: every
 *       declared site names a writer that (a) exists and (b) carries the
 *       serialization the row declares — the transact marker, the skill-tree
 *       write lock, or an instance claim held by that writer — and every N12
 *       state key a row references is live. The family's per-instance serial
 *       queues (`makeSerialQueue`) are the second serialization layer, so a
 *       write site with neither a cross-process lock nor an instance claim is
 *       the "two instances, one file" class: it looks serialized, is not, and
 *       is invisible until it corrupts a file. Read with
 *       evolution-core/persisted-write-inventory.json. The rule arms on that
 *       table: malformed or empty fails, absent is noted here (its presence is
 *       enforced by core's import-time read and write-inventory.spec.ts).
 *
 * Rule ids are APPEND-ONLY labels: docs, probes and register keys reference them,
 * so a landed id is never reused or renumbered. A new rule takes the next free
 * number; --list-rules prints the registry and the docblock inventory must match
 * it (checked at startup, so a rule can never land undocumented).
 *
 * The checks are intentionally fail-loud (zero tolerance): until the G3/G4
 * convergence lands, they report the outstanding copies as a TODO list rather
 * than letting a duplicate drift get merged silently.
 *
 * 0.3.21: runs in WARN mode by default (the 5 outstanding copies are the
 * G3.2/G4.8 convergence TODO — blocking CI on them would hold back this
 * release). Pass `--strict` (or set DSH_EVOLUTION_ARCH_STRICT=1) to fail
 * loud; flip the CI invocation to strict once G3/G4 convergence lands.
 * 0.3.22 (G4.8): N2 single-source moved to evolution-approval/src — the
 * exemption list follows the authority.
 *
 * H2 (0.3.58) heuristic boundary (v12 audit finding N18 — NOT the arch rule of
 * the same id above): the ghost-service-key probe is
 * textual — it detects `has('evolutionX…')` probes and `super(ctx,'…')` /
 * `.provide('…')` declarations. Forms it does NOT see: double-quoted calls,
 * array-form `inject(['evolutionX'])` declarations, and constant indirection
 * where the key never appears as a string literal. Documented, not a
 * guarantee: a new ghost key hidden behind indirection needs the pairing
 * inventory (verify-event-pairing / service-key listing), not this script.
 *
 * Usage (works from BOTH layouts — dev `packages/evolution/scripts/…`, flat
 * mirror `packages/scripts/…`; the packages root argument is the evolution
 * tree regardless of layout):
 *   node <scripts-dir>/verify-arch-guards.mjs <packages/evolution-root> [--strict]
 *   N21. the error codes are spelled ONCE: every `E-3xx:` message lives in the
 *       table at `evolution-core/src/errors.ts`, and any other `src` file that
 *       spells one inside a string literal fails here. The codes used to be
 *       inline at 33 call sites across two packages, so one code's wording could
 *       drift between the branches that answer it and nothing could see the
 *       drift; prose that NAMES a code (the comments explaining which branch
 *       answers which error) stays legal, because the rule reads string
 *       literals only. Render one with `errorText('<scenario>', { a1: ... })`.
 *   N22. a settings namespace is spelled in the registry, never in a domain: the
 *       owner → namespace map (`PARAM_NAMESPACES`) is the one home, and a package
 *       reads it through `paramNamespace(owner)`. A private `X_SETTINGS_NAMESPACE`
 *       constant, or a `?? X_SETTINGS_NAMESPACE` fallback beside the map read, is
 *       a second copy that the registry cannot see — the three that existed here
 *       were all equal to their map entry, so the fallback could never fire and
 *       nobody would have noticed a package whose entry moved.
 *   N23. a durable-file WRITE lives in the IO seam: outside `evolution-core/src/io.ts`
 *       (the node:fs provider) a `src` file that imports `writeFile(Sync)`, `mkdir(Sync)`,
 *       `rename(Sync)`, `copyFile(Sync)`, `rm(Sync)`, `unlink(Sync)`, `appendFileSync` or
 *       `createWriteStream` from `node:fs` fails here unless it is in the register above
 *       with its reason. The seam owns the lock/transaction protocol, so an unregistered
 *       raw writer is exactly the class that skips it silently. Reading is out of scope:
 *       `readFileSync`/`existsSync`/`readdirSync`/`lstat` stay legal anywhere (the audit
 *       behind this rule found four such readers and no fifth writer).
 *   N24. the CLIENT halves carry no literal TYPE or COLOUR: inside any package's
 *       `src/client` tree, a `font-size`/`font`/`font-family` (or their
 *       `fontSize`/`fontFamily` camel forms) whose value is neither `var(--…)`, `calc(…)` nor a
 *       CSS-wide keyword, and any literal colour (`#rgb`/`#rrggbb`, `rgb()`/`hsl()`), fail here.
 *       The panel stylesheet ships as a string inside the bundle, so the platform's
 *       CSS-Modules discipline (tokens only) has to be enforced by the family instead.
 *   N25. the CLIENT halves take radii and hairlines from the family scale: a
 *       `border-radius` that is not `var(--evo-radius-…)`/`0`/`50%`, and a `border`
 *       width that is not `var(--evo-hairline-…)`/`0`/`none`, fail here. The scale is
 *       `packages/scripts/client-tokens.json`, generated into both packages; before it
 *       existed the panel and the settings card used 8/12/999 against 8/6/4.
 *   N26. interaction COLOUR only on an element an interaction reaches: a rule whose
 *       selector has no `:hover`/`:focus`/`:active`/`[aria-…]`/control element and whose
 *       body names `--dsw-alias-interactive-bg-*` or `--dsw-alias-button-primary-*` fails.
 *       The panel's state chip borrowed the interaction fill once, which made a fact read
 *       as something to click (W9).
 *   N27. the CLIENT halves take GEOMETRY from the scale: a padding/margin/gap/size/inset
 *       value that carries a bare pixel length fails. `font-size` and `color` were already
 *       covered by N24; the same drift lived on in shapes (7px against 6px, 264px against
 *       280px). Membership is judged on the string, because jsdom resolves no `var()`.
 *   N28. (E1 in the 0.15.0 plan) a browser half importing a Node builtin (`node:fs`, `node:path`, …) or calling a
 *       byte-changing function (`writeFile(Sync)`, `mkdir(Sync)`, `rm(Sync)`, …) fails: the
 *       client bundle runs in the platform's page, where neither exists, and the host half
 *       owns every byte the family stores.
 *   N29. a client half reads a platform service through a CALLABLE probe, never into a binding at the
 *       apply body's level: a value captured once (`const forms = ctx.get('configForms')`) is read
 *       before the settings shell that provides the seat exists, so the row that activates first
 *       pins every card to the empty state for the life of its fiber — silently, because a missing
 *       seat is a legal state for an optional-service read.
 *   N30. an observable source has ONE owner: `getSnapshot` may be defined only in
 *       `evolution-settings-ui/src/client/source.ts`, and a `hooks` compartment member must be a
 *       REFERENCE to what that module built. The renderer caches one hook binding per source object
 *       and compares the snapshot by reference, so a source built per render re-binds the hook and a
 *       `getSnapshot` that builds an object per call never compares equal: React aborts the card
 *       (minified invariant #185) and the slot error boundary swaps it for an empty placeholder —
 *       which is how all five parameter cards disappeared on the 0.2.0 desktop.
 *   N34. the settings USER LAYER is read in exactly ONE place: `evolution-core/src/params.ts`
 *       (`userSetKeys(ctx, paramRowId(owner))`). A package that reads
 *       `describe({ redactSecrets: false })` and takes `Object.keys(entry.user)` for itself holds a
 *       second copy of a platform fact, and the precedence rule (user > policy > row) can then
 *       resolve one key two ways — the four copies that had grown (review, curator, memory-files,
 *       tool-skill-manage) each carried their own clamp-and-warn helper beside them too.
 *   N35. a PLATFORM `file:line` citation is a FROZEN BASELINE. N15 resolves the family's own
 *       anchors; a platform path names another repository's file, so its line number rots at every
 *       upstream bump and nothing here can re-derive it. 55 such cites exist at this revision
 *       (hand-checked then, T2-08/A23 is where they surfaced). The rule freezes the count PER FILE:
 *       a new citation fails, and the register burns down as files are touched — the fix is the one
 *       S2.7 applied to the family's own comments, a symbol citation instead of a line number.
 *       `packages/docs/**` (the machine-local archive) is fenced by name.
 *   N36. the EXPRESSION form of the N14 swallow is a FROZEN BASELINE. N14's regex requires the
 *       `catch` to be followed by `{`, so `await io.readText(p).catch(() => null)` — a read
 *       FAILURE served as ABSENT — was structurally invisible while the family's own register
 *       claimed the class was clean. 18 such sites remain after the S3.2 migrations that mattered
 *       (the skill-history rescue path and the archive restore's three reads); the rest are
 *       reviewed and listed per file. A new one fails; the register only burns down, and the whole
 *       class is scheduled for the three-state sweep (O-7).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { docFactViolations, factTableProblems, formatDocFacts } from './lib-doc-facts.mjs'

const root = process.argv[2] ?? 'packages/evolution'
// R-03: a missing root used to surface as a raw ENOENT from readdirSync —
// report the usage line instead (same posture as verify-dependency-closure).
if (!existsSync(root)) {
  console.error(`usage: verify-arch-guards.mjs <packages/evolution-root> [--strict] (root not found: ${root})`)
  process.exit(2)
}
const strict = process.argv.includes('--strict') || process.env.DSH_EVOLUTION_ARCH_STRICT === '1'
const CORE_SRC = 'evolution-core/src'

/** N21: the one file allowed to spell an error message. */
const ERROR_TABLE_OWNER = CORE_SRC + '/errors.ts'

/**
 * N21: `E-3xx:` messages spelled OUTSIDE the table.
 * @param text - one file's source.
 * @returns the codes spelled inside a string literal on the same line.
 */
function errorCodeLiterals(text) {
  const out = []
  for (const match of text.matchAll(/E-3[0-9][0-9]:/g)) {
    const before = text.slice(0, match.index)
    const line = before.slice(before.lastIndexOf('\n') + 1)
    let quote = null
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '\\') { i += 1; continue }
      if (quote === null && (ch === "'" || ch === '"' || ch === '`')) quote = ch
      else if (quote !== null && ch === quote) quote = null
    }
    if (quote !== null) out.push(match[0].slice(0, -1))
  }
  return out
}

/** N23: the files allowed to write durable files directly, and why. */
const IO_SEAM_WRITERS = new Set([CORE_SRC + '/io.ts'])
const RAW_WRITE_REGISTER = new Set([
  // The preset installer writes DEPLOYMENT assets (not the state medium) with its own
  // atomic stage→rename protocol and an injectable FsOps surface (F-211); routing it
  // through ctx.evolutionIo would couple a one-shot installer to the runtime seam.
  'evolution-commands/src/index.ts',
])

/** `node:fs` specifiers, either face, with or without the `node:` prefix. */
const FS_SPECIFIER = /^(?:node:)?fs(?:\/promises)?$/

/**
 * The fs APIs that only READ. Every other name imported from an fs specifier counts as a
 * write, so an unrecognized API (`open`, `openSync`, a future addition) fails closed.
 */
const FS_READ_APIS = new Set([
  'readFileSync', 'readFile', 'readdirSync', 'readdir', 'opendirSync', 'opendir',
  'existsSync', 'statSync', 'stat', 'lstatSync', 'lstat', 'realpathSync', 'realpath',
  'accessSync', 'access', 'readlinkSync', 'readlink', 'createReadStream', 'watch', 'watchFile',
])

/**
 * N23: fs imports a `/src/` file could write through.
 *
 * Judged in reverse of a write-name whitelist, which missed `open` + `writeFile`,
 * `promises as fsp`, the specifier without the `node:` prefix, and the dynamic forms —
 * each of them reaches the same syscalls while the rule stayed green.
 * @param text - one file's source.
 * @returns the offending imports (a namespace import reads `<name> (namespace)`, a dynamic
 *   import or `require` call reads `<dynamic> <specifier>`).
 */
function fsWriteImports(text) {
  const found = []
  for (const match of text.matchAll(/import\s+([^;]+?)\s+from\s+['\"]([^'\"]+)['\"]/g)) {
    if (!FS_SPECIFIER.test(match[2])) continue
    const clause = match[1].trim()
    // `import type { Dirent } from 'node:fs'` is a TYPE import: it writes nothing (the
    // shape that produced this rule's first false positive).
    if (clause.startsWith('type')) continue
    if (!clause.startsWith('{')) { found.push(clause.split(/\s+as\s+/)[0] + ' (namespace)'); continue }
    for (const raw of clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}')).split(',')) {
      const cell = raw.trim()
      if (cell === '' || cell.startsWith('type ')) continue
      const name = cell.split(/\s+as\s+/)[0]
      if (!FS_READ_APIS.has(name)) found.push(name)
    }
  }
  for (const match of text.matchAll(/(?:import\s*\(|require\s*\()\s*['\"]([^'\"]+)['\"]\s*\)/g)) {
    if (FS_SPECIFIER.test(match[1])) found.push('<dynamic> ' + match[1])
  }
  return found
}

/**
 * N22: settings-namespace literals declared outside the registry.
 * @param text - one file's source.
 * @returns the offending spellings (a duplicate constant, or a `??` fallback).
 */
function namespaceSplits(text) {
  const out = []
  for (const match of text.matchAll(/export const ([A-Z_]+_SETTINGS_NAMESPACE)[\s]*=/g)) out.push(match[1])
  for (const match of text.matchAll(/[\?][\?][\s]*([A-Z_]+_SETTINGS_NAMESPACE)/g)) out.push(match[1] + ' (fallback)')
  return out
}
/**
 * N34: a settings USER-LAYER key read outside evolution-core.
 * @param text - one file's source.
 * @returns the offending excerpt, one entry per read.
 */
function settingsUserLayerReads(text) {
  const out = []
  for (const match of text.matchAll(/Object\.keys\([A-Za-z_$][\w$]*\?\.user \?\? \{\}\)/g)) out.push(match[0])
  return out
}
/**
 * N35: PLATFORM (another repository's) `file:line` citations in this tree.
 *
 * A citation resolves as a family anchor when its path exists under the root; anything else names a
 * file this repository does not own.
 * @param root - the family root.
 * @param text - one file's source.
 * @returns the cited strings that do not resolve inside the family tree.
 */
function platformCiteSites(root, text) {
  const out = []
  for (const match of text.matchAll(/(?<![\w/.-])(?:packages\/)?(?:[a-z0-9-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|mjs|cjs):\d+/g)) {
    const path = match[0].replace(/:\d+$/, '').replace(/^packages\//, '')
    if (existsSync(join(root, path))) continue
    out.push(match[0])
  }
  return out
}

/** N35's frozen baseline: how many platform line-cites each file carried when the rule landed
 * (S2.9, after A23 surfaced the class). Burn-down only: as a file is touched, convert its cites to
 * symbol citations and lower its number here. A file absent from this map may carry none.
 *
 * The map must cover EXACTLY the files the scan below reaches: this guard skips its own file
 * (`SELF_REL`, the same exemption N15 uses), so an entry for it could never fire and would only
 * make the register disagree with a recount (`scripts/count-platform-cites.mjs`, which applies the
 * same exemption). */
const PLATFORM_CITE_BASELINE = new Map([
  ['evolution-commands/src/index.ts', 3],
  ['evolution-core/src/constants.ts', 1],
  ['evolution-core/src/io.ts', 1],
  ['evolution-core/src/opt-in.ts', 1],
  ['evolution-core/src/preset-composition.ts', 1],
  ['evolution-core/src/scope.ts', 2],
  ['evolution-core/src/session-projection.ts', 2],
  ['evolution-core/src/tool-dispatch.ts', 4],
  ['evolution-core/tests/preset-composition.spec.ts', 1],
  ['evolution-core/tests/tool-dispatch.spec.ts', 2],
  ['evolution-curator/src/index.ts', 4],
  ['evolution-host/tests/guard-scripts.spec.ts', 1],
  ['evolution-host/tests/installer-preset-base.spec.ts', 1],
  ['evolution-host/tests/installer.spec.ts', 1],
  ['evolution-maintenance/src/tools.ts', 1],
  ['evolution-review/src/index.ts', 4],
  ['evolution-review/src/review-notice.ts', 1],
  ['evolution-review/tests/review.spec.ts', 1],
  ['evolution-settings-ui/src/client/seam.ts', 1],
  ['memory-files/src/index.ts', 1],
  ['scripts/gen-param-client-view.mjs', 1],
  ['scripts/install-layered.mjs', 2],
  ['scripts/verify-param-channel-parity.mjs', 4],
  ['scripts/verify-platform-contract.mjs', 2],
  ['tool-memory/src/index.ts', 1],
  ['tool-skill-manage/src/index.ts', 5],
  ['tool-skill-manage/tests/skill-settings.spec.ts', 1],
])

/** N36: promise-form swallows of a durable read — the line calls a read method AND its `catch`
 * answers an absent literal. Line-local by design (same posture as N14).
 * @param text - one file's source.
 * @returns the 1-based line numbers of the matches.
 */
function swallowedReadSites(text) {
  const out = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!READ_METHOD_RE.test(line)) continue
    if (!ABSENT_CATCH_RE.test(line)) continue
    out.push(index + 1)
  }
  return out
}
/** The read vocabulary whose failure must stay distinguishable from absence. */
const READ_METHOD_RE = /\.(readText|readJson|readFile|size|list|mtime|exists|loadAll)\s*\(/
/** The absent literals a swallowed read may answer with. */
const ABSENT_CATCH_RE = /\.catch\s*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>\s*(?:null|undefined|false|\[\s*\]|''|"")\s*\)/

/** N36's frozen baseline: reviewed expression-form swallows per file, measured after the S3.2
 * migrations (S3.2, 2026-10). Burn-down only: migrating a site to probeText/probeList/probeMtime
 * lowers its number here; the class itself is scheduled for the group-5 three-state sweep. */
const SWALLOWED_READ_BASELINE = new Map([
  ['evolution-core/src/skill-history.ts', 3],
  ['evolution-core/src/skill-store.ts', 9],
  ['evolution-curator/src/index.ts', 1],
  ['evolution-feedback/src/index.ts', 1],
  ['evolution-skill-catalog/src/index.ts', 1],
  ['evolution-state-json/src/index.ts', 3],
])

const APPROVAL_SRC = 'evolution-approval/src'
const SKIP = new Set(['node_modules', 'lib', 'dist', 'dist.next', 'dist.previous', '.release-staging', '.git', '.next', '.release-staging.next', '.release-staging.previous', 'tsdown'])
const DSH_HOME_RE = /process\.env\.DSH_HOME|process\.env\[['\"]DSH_HOME['\"]\]/
const COPY_RE = /interface\s+ApprovalPolicyLike|function\s+effectiveSessionPolicy/
// N5 (v39): family package imports — L0 seams are the only ones the kernel
// may reach; everything else is a layering inversion.
const FAMILY_IMPORT_RE = /from\s+['"](@deepseek-ai\/dsh-evolution-[a-z0-9-]+|@deepseek-ai\/dsh-memory)['"]/g
const CORE_ALLOWED_FAMILY = new Set([
  '@deepseek-ai/dsh-evolution-core',
  '@deepseek-ai/dsh-evolution-state-storage',
  '@deepseek-ai/dsh-memory',
])
// N6 (v39): composition-only packages (see docblock).
const BUNDLE_PKGS = new Set(['evolution-host', 'evolution-all', 'evolution-preset', 'evolution-agent'])
// N7 (v39, S3.1; converged 0.3.75, v41 P2-26): direct construction sites.
// The list is EMPTY on purpose — every site routes through core's
// newSkillLibrary(), so a new entry means someone re-opened the divergence.
const SKILL_LIBRARY_RE = /\bnew SkillLibrary\(/
const SKILL_LIBRARY_TODO = new Set([])
// N9 (v39, S0.4 invariant): format-control classes must not be hand-written.
const REGEXP_CLASS_RE = /new RegExp\(`\[([^`]*)\]`/g
const FORMAT_CLASS_TOKEN_RE = /\\p\{Cf\}/
// N10 (v39, S3.4 rule ④): a NEW `ctx.get('<platform service>')` probe must
// carry a platform-declaration anchor in its file (optional services are read
// through ctx.get — postmortem 0001). Baselines are the pre-v39 site counts;
// a file already mentioning the platform passes.
const PLATFORM_GET_RE = /ctx\.get\('(?!evolution)[A-Za-z][\w-]*'\)/g
const PLATFORM_GET_BASELINE = new Map([
  ['evolution-commands/src/index.ts', 4],
  ['evolution-approval/src/index.ts', 3],
  ['evolution-curator/src/index.ts', 2],
  ['tool-skill-manage/src/index.ts', 2],
  ['evolution-learning-graph/src/index.ts', 2],
  ['evolution-state-domain/src/index.ts', 1],
  ['evolution-review/src/index.ts', 9],
  ['evolution-maintenance/src/orchestrate.ts', 1],
  ['evolution-maintenance/src/enrichment.ts', 1],
  ['tool-memory/src/index.ts', 1],
])
// N11 (v37 P7a): the platform dispatch vocabulary has ONE reader.
const DISPATCH_EVENT_TYPE_RE = /['"`](tool\/(?:call|result|ptc-dispatch-start|ptc-dispatch))['"`]|\b(?:PTC_DISPATCH_START_EVENT|PTC_DISPATCH_EVENT|NATIVE_CALL_EVENT|NATIVE_RESULT_EVENT)\b|\bDISPATCH_EVENT_TYPES\b/g
const DISPATCH_GUARD_MODULE = 'evolution-core/src/tool-dispatch.ts'
/** Synthetic session logs are built in tests; a test may name the types it writes. */
const DISPATCH_GUARD_TEST_SUFFIXES = ['.spec.ts', '.test.ts', '.probe.ts', '.e2e.ts']
// N17 (0.3.77): the dispatch KIND is a route fact owned by tool-dispatch.ts.
// The literals are the signal (so string literals are NOT masked here, unlike
// the delivery rules); prose in comments still is.
const MODALITY_KIND_RE = /\b[A-Za-z_$][\w$]*\.kind\s*(?:===|!==)\s*(['"])(?:native|program|program-root)\1|(['"])(?:native|program|program-root)\2\s*(?:===|!==)\s*[A-Za-z_$][\w$]*\.kind\b/g
const DISPATCH_KIND_OWNER = 'evolution-core/src/tool-dispatch.ts'
const MODALITY_BRANCH_REGISTER = new Map([
  ["evolution-core/src/signals.ts :: dispatch.kind !== 'program'", 'v37 P7a: the ONE split that must exist — toolCalls feeds the review cadence, and the sub-dispatches of a program are not model calls (counting them would let one 50-operation program advance the interval by 50 turns). Every other consumer reads names/counts through skillReadNameOf / countDispatches, which are modality-blind.'],
])
/** N17: every comparison of a dispatch kind against a modality literal. */
function modalityBranchKeys(text) {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, mask)
    .replace(/^[ \t]*\/\/.*$/gm, mask)
  return [...code.matchAll(MODALITY_KIND_RE)].map(match => squash(match[0]))
}
// N18 (0.3.77): a `session/event` listener that never asks the opt-in gate acts
// on sessions the family was never mounted into (the C-axis class); the receiver
// idiom is event-pairing's `\w*[Cc]tx` (camelCase aliases count).
const SESSION_STREAM_RE = /\w*[Cc]tx\.on\(\s*['"`]session\/event['"`]/g
const SESSION_GATE_RE = /sessionAudited\(|sessionSeesFamilyTools\(/
const SESSION_GATE_REGISTER = new Map([
  // EMPTY on purpose (0.3.77, verified): the family's two session/event consumers
  // (evolution-review, skill-usage) both call sessionAudited at the top of the
  // listener, so a new entry here is a new divergence, not a debt.
])
/** N18: session/event subscriptions in a file that never consults the gate. */
function ungatedSessionStreamKeys(text) {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, mask)
    .replace(/^[ \t]*\/\/.*$/gm, mask)
  if (SESSION_GATE_RE.test(code)) return []
  return [...new Set([...code.matchAll(SESSION_STREAM_RE)].map(match => squash(match[0])))]
}
// N12 (P5): module-scope mutable process state. Key = '<file> :: <binding>'.
const MUTABLE_STATE_RE = /^const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+(?:Set|Map|WeakMap)\b/gm
const MUTABLE_STATE = new Map([
  // The "validity single-process" tail of every row is the assumption N20 makes
  // explicit: evolution-core/persisted-write-inventory.json declares, per write
  // site, what keeps two writers apart (transact / write-lock / instance claim),
  // and N20 fails when the declared serialization is not in the code.
  ['evolution-core/src/instance-scope.ts :: claims', 'B3 / G4 (0.3.78): the per-home single-instance claims (home :: key -> holder). Every sidecar writer runs on a per-instance serial queue, so ONE instance per home may own a writer key; lifecycle claimInstance (get-or-set, re-entrant for the same owner) / releaseInstance (owner-only delete, called from the consumer disposer); evidence evolution-core/tests/instance-scope.spec.ts and evolution-curator/tests/instance-claim.spec.ts; validity single-process (the cross-process half is the IO write lock), listed in persisted-write-inventory.json.'],
  ['evolution-core/src/review-channel.ts :: markedSessions', 'v37 S2.2: session.header.origin is a closed set (only \'subagent\'), so a plugin-driven turn cannot be attributed by the platform; lifecycle markReviewChannel / clearReviewChannel / sweepReviewChannelSessions; evidence evolution-core/tests/review-channel.spec.ts; validity single-process.'],
  ['evolution-state-json/src/index.ts :: recordGateWarned', 'per-file warn de-duplication; the platform exposes no per-session warn channel; lifecycle session-scoped Set; validity single-process.'],
  ['evolution-state-json/src/index.ts :: corruptWritten', 'file -> quarantine copy already written, so repeated corruption does not re-copy; lifecycle written with the .corrupt copy, cleared when the file parses again; validity single-process.'],
  ['evolution-state-json/src/index.ts :: corruptWriteWarned', 'warn de-duplication for the quarantine copy; lifecycle cleared with corruptWritten; validity single-process.'],
  ['evolution-core/src/signals.ts :: dispatchLedgers', 'v37 P7a: the platform writes ONE dispatch vocabulary per mounted runtime mode, and the fold needs per-turn state the TurnSignals value cannot carry; lifecycle normalizerForSignal (get-or-create) with weak keys, so entries die with the signal object; evidence evolution-core/tests/tool-dispatch.spec.ts; validity single-process.'],
])
// N13a (P5): must-execute payloads still on the non-waking primitive.
const AGENT_INJECT_RE = /([A-Za-z_$][\w$.]*)\.inject\(/g
const INJECT_SITES = new Map([
  ['evolution-review/src/index.ts :: agent.inject(message)', 'pre-deliverEnsuringWake gap: the reviewWakeInject:false / host-without-followup degradation; migrate to deliverEnsuringWake() (followup -> steer -> typed failure).'],
  ['evolution-commands/src/index.ts :: invocation.agent.inject(message)', 'pre-deliverEnsuringWake gap: /evolution learn on a host without followup; same migration.'],
])
// N13b (P5, 0.3.73): a wake primitive read into a local loses its receiver.
// Sensitivity follows the INCIDENT SHAPES, not the simplest spelling: the
// 0.3.73 code took it through a type assertion
// (`agent as { followup?: (m: unknown) => void }`), so leading assertions and
// parens are stripped before the member test, and the destructuring form
// (`const { inject } = invocation.agent`) counts as well — a detached method
// loses `this` whichever primitive it is. F1 (v41 phase-1 review).
// A REFERENCE to the member (not a call to it): assertions/parens may wrap the
// receiver, but `agent.followup(msg)` — whose RESULT is legitimately
// assignable — must stay clean, hence the call lookahead.
const WAKE_MEMBER_RE = /\.(?:followup|steer)\b(?!\s*\()/
const AGENT_DESTRUCTURE_RE = /(?:const|let|var)\s*\{[^}]*\}\s*=\s*[A-Za-z_$][\w$.]*\b(?:agent|followup|steer)\b/g

function wakeLocalKeys(text) {
  const keys = []
  for (const match of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g)) {
    const rhs = match[2] ?? ''
    // `typeof x.followup === 'function'` is a capability PROBE: nothing is
    // detached and nothing is called (the real site in evolution-commands).
    // A ternary over the probe is still a detachment, so only a plain typeof
    // comparison is exempt.
    // Strip `as { … }` assertions first: their optional markers are not a
    // ternary, and a plain `typeof` probe that is not part of one is exempt.
    const probe = rhs.replace(/\bas\s*\{[^}]*\}/g, '')
    if (/^\s*typeof\b/.test(probe) && !probe.includes('?')) continue
    if (WAKE_MEMBER_RE.test(rhs)) keys.push(match[0])
  }
  for (const match of text.matchAll(AGENT_DESTRUCTURE_RE)) keys.push(match[0])
  return keys
}
// N14 (P5): a durable-read failure degraded to 'absent'. Key = 'try {<100 chars>} catch -> absent'.
const CATCH_ABSENT_RE = /catch\s*(?:\([^)]*\))?\s*\{/g
const DURABLE_READ_RE = /\b(?:readFile|readdir|statSync|readText|list|listFiles)\s*\(/
// v41 phase-1 follow-up: the migration the entries below name has LANDED —
// `evolution-core/src/probe.ts` exports the read three-state
// (`Probe<T>` = present | absent | unknown{reason}) and its first real
// consumer is `tool-skill-manage`'s catalogWinner ({ winner, unverifiable }
// allowed the illegal combination, so the union replaced it). The remaining
// entries below still describe their own site; their "migrate to the union"
// tail is the checklist for the next pass, not a re-design.
// B3 / G4 (0.3.78): the four remaining debts are CLEARED — every durable read
// behind them now goes through probeList/probeMtime (probe.ts), so an
// unreadable store is unknown{reason} and only a genuinely missing path (or
// the backend's own "missing reads as empty", rc.50 P2-4) is absent:
//   - evolution-commands' fs adapter returns null for ENOENT/ENOTDIR only and
//     RETHROWS every other stat failure, which probeMtime reports as unknown;
//   - skill-store's listSupportFiles answers Probe<string[]> (a partial listing
//     is unknown, never a short list that reads as complete);
//   - skill-store's listSnapshots answers Probe<...> and BOTH consumers respect
//     it: retention prunes nothing it cannot enumerate, and the restore refuses
//     with the read reason instead of "No skill snapshot available";
//   - evolution-curator's latestReport/retainReports separate a missing reports
//     directory from an unreadable one (the warn names the failure).
// The register stays EMPTY on purpose: it is a defect list, and the whole list
// landed. A new entry means a new two-state read — migrate it, do not grow this.
const SWALLOW_CATCH = new Map([])
/** N3 (gate): bare `z.number()` config fields with no bound, one finding per line.
 * Single-line scanning on purpose (the boundary note lives at the call site): a
 * chained `.min()` on the next line is not consulted.
 * @param text - the file's source.
 * @returns the offending line numbers.
 */
function unclampedNumericFieldLines(text) {
  const found = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const code = (lines[i] ?? '').replace(/\/\/.*$/, '').trim()
    if (!/z\.number\(\)/.test(code)) continue
    if (/\.(?:min|max|finite|nonnegative)\(/.test(code)) continue
    found.push(i + 1)
  }
  return found
}

/** N6: what a composition bundle file carries besides imports, re-exports and `export {}`.
 * @param text - the file's source.
 * @returns the residue (empty string when the file is composition only).
 */
function bundleRuntimeResidue(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/import\s+(?:type\s+)?[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
    .replace(/export\s+(?:type\s+)?[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
    .replace(/export\s*\{\s*\};?/g, '')
    .trim()
}

/** H2 (v11): probed evolution service keys with no provider anywhere (the P0-1 class).
 * @param probed - the keys the tree probes.
 * @param provided - the keys some package provides.
 * @returns the ghost keys.
 */
function ghostServiceKeys(probed, provided) {
  return [...probed].filter(key => !provided.has(key))
}

/** N8 (v37 S2.1 / I-3): is this package an `./invariant` companion nobody mounts?
 * The scan supplies the facts; the decision lives here so it can be self-tested.
 * @param hasSrcInvariant - `src/invariant.ts` exists.
 * @param manifestPublishes - the manifest publishes `./invariant`.
 * @returns true when the package would be reported.
 */
function isInvariantCompanion(hasSrcInvariant, manifestPublishes) {
  return hasSrcInvariant || manifestPublishes
}

/** N10 (v39, S3.4 rule 4): new platform-service probes in a file that carries no anchor.
 * The file-level exemption is a `platform` mention (the docblock owns the rationale).
 * @param text - the file's source.
 * @param rel - the tree-relative path.
 * @param baseline - how many probes this file is already recorded as carrying.
 * @returns the number of unanchored probes.
 */
function unanchoredPlatformProbes(text, rel, baseline) {
  const sites = (text.match(PLATFORM_GET_RE) ?? []).length
  if (!rel.includes('/src/') || sites <= baseline || /platform/i.test(text)) return 0
  return sites - baseline
}

/** N11 (v37 P7a): dispatch-vocabulary sites in a file that is not the guard module.
 * Prose is inert: comments are stripped, and only string literals short enough to BE
 * an event type survive (longer ones are prompt text that merely mentions a type).
 * @param text - the file's source.
 * @returns the matched fragments.
 */
function dispatchVocabularySites(text) {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, match => match.length <= 40 ? match : '""')
  return [...code.matchAll(DISPATCH_EVENT_TYPE_RE)].map(match => match[0])
}
/** Rule registry (append-only; --list-rules prints it and the docblock must match). */
/** Rule registry (append-only; --list-rules prints it and the docblock must match).
 * Every entry carries its own contract: `incident` (the shape the rule exists for),
 * `canonicalForm` (what a clean tree looks like), `vacuity` (how the rule proves it is
 * not vacuous) and `sample` (where that proof lives). `sample: detector` means the
 * startup self-test below covers it; `sample: pending` with a `sampleExpiry` is a
 * registered, expiring debt — never a silent pass (the F-103 class, one level up). */
const RULES = [
  { id: 'N1', title: 'DSH_HOME single source (evolution-core/src only)', incident: 'a second file reads env.DSH_HOME and the home path forks silently', canonicalForm: 'only evolution-core resolves the home; every other package takes it from the seam', vacuity: '.ts files absent under the root ⇒ the scan guard fires; the sample carries the proof', sample: 'detector' },
  { id: 'N2', title: 'ApprovalPolicyLike / effectiveSessionPolicy single-sourced in evolution-approval', incident: 'effectiveSessionPolicy re-implemented outside evolution-approval', canonicalForm: 'one definition in evolution-approval; other packages import it', vacuity: 'no policy copy in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N3', title: 'Config numeric fields carry a value clamp', incident: 'a z.number() config field with no bound, so an out-of-range value lands', canonicalForm: 'clampedNumber(min, max) or explicit .min/.max on every numeric config field', vacuity: 'no numeric config field in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'H2', title: 'no ghost evolution* service key (probe without provider)', incident: 'a probe for an evolutionX service key with no provider registered anywhere: a silent absent', canonicalForm: 'every probed evolution* key has a provider registration somewhere in the tree', vacuity: 'no evolution* probe in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N5', title: 'evolution-core imports only the L0 seams', incident: 'evolution-core importing an L1 package (layer inversion)', canonicalForm: 'evolution-core imports only its L0 seams', vacuity: 'the kernel imports nothing ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N6', title: 'composition bundles carry no runtime code', incident: 'a composition bundle shipping runtime code', canonicalForm: 'bundles are composition only (patch rows and preset rows)', vacuity: 'no bundle ships a src file ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N7', title: 'new SkillLibrary() only through the core helper', incident: 'a package constructing SkillLibrary directly: a second construction path', canonicalForm: 'construction goes through the helper exported by evolution-core', vacuity: 'no construction site ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N8', title: 'no unpublished ./invariant companion', incident: 'an ./invariant subpath that the published manifest does not declare', canonicalForm: 'every exported subpath is declared and published', vacuity: 'zero manifests read is a VIOLATION (a vacuum pass is not a pass); the sample carries the decision proof', sample: 'detector' },
  { id: 'N9', title: 'format-control classes built from FORMAT_CONTROL_CLASS', incident: 'a literal format-control class string', canonicalForm: 'classes come from FORMAT_CONTROL_CLASS', vacuity: 'the threats file is absent ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N10', title: 'new platform-service probe carries a declaration anchor and a probe-table entry', incident: 'a new ctx.get(<platform service>) with no CONTRACT_ANCHORS entry, or a probe the capability-absence table does not declare', canonicalForm: 'each platform probe carries an anchor in the contract probe table AND is declared in core PLATFORM_SERVICE_PROBES (the O-2 capability-absence home)', vacuity: 'no platform probe in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N11', title: 'ONE reader for the platform dispatch vocabulary', incident: 'a second reader of the dispatch kind vocabulary', canonicalForm: 'one module owns the vocabulary and everyone else imports it', vacuity: 'no dispatch literal outside the guard module ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N12', title: 'module-scope mutable process state is registered', incident: 'module-scope mutable state with no registration', canonicalForm: 'registered with owner, lifetime and evidence', vacuity: 'an empty registration table is clean by design; the sample carries the proof', sample: 'detector' },
  { id: 'N13a', title: 'must-execute payload not on the non-waking primitive', incident: 'a must-execute payload sent through the non-waking primitive', canonicalForm: 'must-execute payloads use the waking primitive (followup)', vacuity: 'an empty debt register is clean by design; the sample carries the proof', sample: 'detector' },
  { id: 'N13b', title: 'wake primitive called on its receiver', incident: 'the wake primitive detached (destructured or aliased) and then called', canonicalForm: 'the wake primitive is called on its receiver: agent.followup(message)', vacuity: 'an empty debt register is clean by design; the sample carries the proof', sample: 'detector' },
  { id: 'N14', title: 'durable-read failure not served as absent', incident: 'catch { return [] }: a read failure served as absent', canonicalForm: 'Probe<T> three states; a failure keeps its reason', vacuity: 'an empty swallow register is clean by design; the sample carries the proof', sample: 'detector' },
  { id: 'N15', title: 'family code anchors resolve (Markdown, scripts and source comments)', incident: 'an anchor naming a line that no longer exists, in a document, a script or a source comment', canonicalForm: 'anchors resolve in every citation surface; symbolic references are preferred over line numbers', vacuity: 'no Markdown anchor in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N16', title: 'platform registry read asks in the calling scope', incident: 'ctx.get(<registry>) followed by r.get(name) without a scope', canonicalForm: 'the read asks in the calling scope: r.get(name, scope)', vacuity: 'no registry read in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N17', title: 'dispatch modality is read in registered sites only', incident: 'branching on dispatch.kind outside the registered sites', canonicalForm: 'the single vocabulary reader is consulted only where registered', vacuity: 'no modality branch in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N18', title: 'session/event consumers consult the opt-in gate', incident: 'a session/event consumer that never consults the audited gate', canonicalForm: 'the consumer consults sessionAudited before reading the stream', vacuity: 'no session/event consumer in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N19', title: 'one home per family fact (docs cite, never copy)', incident: 'a fact with no home, no must entry, or an empty table', canonicalForm: 'every fact carries id, home, must, and cites its machine owner', vacuity: 'an empty fact table is a VIOLATION and a fact without a home is too; the sample asserts both', sample: 'detector' },
  { id: 'N20', title: 'declared persisted write sites match their writers', incident: 'a writer with the wrong serialization, or a claim nobody makes', canonicalForm: 'persisted-write-inventory.json matches the writers in the tree', vacuity: 'no write inventory under the root ⇒ the rule is NOT ARMED (printed, never silent); the sample carries the proof', sample: 'detector' },
  { id: 'N21', title: 'error codes are spelled once, in evolution-core/src/errors.ts', incident: 'a literal E-3xx string outside errors.ts', canonicalForm: 'codes come from errors.ts (errorText or the code table)', vacuity: 'no error-code literal outside errors.ts ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N22', title: 'settings namespaces are spelled once, in the registry', incident: 'a namespace literal spelled outside PARAM_NAMESPACES', canonicalForm: 'namespaces come from the registry', vacuity: 'no namespace literal outside the registry ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N23', title: 'durable-file writes live in the IO seam', incident: 'a durable-file write outside the IO seam', canonicalForm: 'writes go through the seam (transactIo and friends)', vacuity: 'no raw write import ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N24', title: 'client halves carry no literal type or colour', incident: 'font-size: 13px or #ff0000 inside a client half', canonicalForm: 'type and colour come from tokens', vacuity: 'no client half in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N25', title: 'client halves take radii and hairlines from the scale', incident: 'a literal border-radius or hairline width', canonicalForm: 'radii and hairlines come from the scale', vacuity: 'no client half in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N26', title: 'interaction colour only on an element an interaction reaches', incident: 'an interaction colour on a static, unreachable element', canonicalForm: 'interaction colour sits only on an element an interaction reaches', vacuity: 'no client half in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N27', title: 'client halves take geometry from the scale', incident: 'a literal padding, gap or size inside a client half', canonicalForm: 'geometry comes from the scale', vacuity: 'no client half in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N28', title: 'client halves import no node builtin and write nothing (E1)', incident: 'a node builtin import or a write call inside a client half', canonicalForm: 'client halves stay pure: no builtins, no writes', vacuity: 'no client half in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N29', title: 'a client entry reads a platform service through a callable probe', incident: 'a direct property read of a platform service in a client entry', canonicalForm: 'the read goes through a callable probe', vacuity: 'no client entry in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N30', title: 'an observable source has one owner; hooks carry references', incident: 'an inline source object built per render, or a hook returning a fresh reference', canonicalForm: 'one owner per source and stable references from hooks', vacuity: 'no observable source in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N34', title: 'the settings user layer is read once, in evolution-core', incident: 'a package reading the settings user layer itself and taking its key names, so one key resolves two ways', canonicalForm: 'userSetKeys(ctx, paramRowId(owner)) is the only reader; consumers pass their own row id', vacuity: 'no user-layer read in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N35', title: 'a platform file:line citation is a frozen baseline', incident: 'a new citation of another repository line number, which no guard here can re-derive when that file moves', canonicalForm: 'platform references cite a symbol, not a line number; the frozen register only burns down', vacuity: 'no platform citation in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
  { id: 'N36', title: 'a promise-form swallow of a durable read is a frozen baseline', incident: 'await io.readText(p).catch(() => null): a read failure served as absent, invisible to the catch-block rule', canonicalForm: 'durable reads use the three-state probe; a reviewed expression-form swallow is listed and only burns down', vacuity: 'no expression-form swallow in the tree ⇒ pass; the sample carries the proof', sample: 'detector' },
]

/** Guards whose vacuum face is known and NOT yet handled: a registered, expiring debt.
 * Every entry names the sibling guard, what an empty input looks like there, the step
 * that closes it, and the evidence that it is real. All four fields are required — an
 * entry without them is a bug in this register, not a note. The debt is printed on
 * every run so it cannot be forgotten silently (the F-103 vacant-guard class). */
const GUARD_VACUITY = [
  // EMPTY since v46 S3.8: the one entry (verify-skill-roots.mjs, expiry S3.8) is CLOSED — the
  // guard now judges the EFFECTIVE roots of every derived skill-root consumer (non-vacuous with
  // zero declared rows, which is the shipped state) and exits 2 when the derivation itself comes
  // back empty. A new entry here means a guard that can only pass.
]

/**
 * N24 (0.14): literal type and colour inside a client half, as one finding per occurrence.
 * @param text - the file's source.
 * @returns every offending fragment (`font-size: 13px`, `#ff0000`, …); empty when the file is clean.
 */
function clientStyleLiterals(text) {
  // Comments may discuss a literal without shipping one (`// no font-size here`).
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const findings = []
  for (const match of stripped.matchAll(/\b(font-size|font-family|font|fontSize|fontFamily)\s*:\s*(['"]?)([^;'"}\n,]*)/g)) {
    const value = (match[3] ?? '').trim()
    if (value === '' || value.startsWith('var(') || value.startsWith('calc(')) continue
    if (/^(inherit|initial|unset|revert|revert-layer)$/.test(value)) continue
    findings.push(match[1] + ': ' + value)
  }
  for (const match of stripped.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/g)) findings.push(match[0])
  return findings
}

/** A client half's source without its comments: prose may discuss a literal without shipping one. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * N25 (0.15): a radius or a hairline width written as a literal inside a client half.
 *
 * The family's two browser halves draw from ONE scale (`packages/scripts/client-tokens.json`, generated
 * into each package): before it existed the panel and the settings card used 8/12/999 against 8/6/4 and
 * four different hairline levels, and nothing could tell them apart. A literal here means someone went
 * around the scale, which is exactly the drift the rule exists to stop.
 * @param text - the file's source.
 * @returns every offending declaration (`border-radius:6px`, `border:.5px solid …`).
 */
function clientScaleLiterals(text) {
  const stripped = withoutComments(text)
  const findings = []
  for (const match of stripped.matchAll(/\bborder-radius\s*:\s*([^;'"}\n]+)/g)) {
    const value = (match[1] ?? '').trim()
    if (value.startsWith('var(--evo-radius-') || value === '0' || value === '50%' || value === 'inherit') continue
    findings.push('border-radius: ' + value)
  }
  for (const match of stripped.matchAll(/\bborder(?:-(?:top|bottom|left|right))?(?:-width)?\s*:\s*([^;'"}\n]+)/g)) {
    // In the shorthand the WIDTH is the first component; a hairline is that component, never a colour.
    const value = (match[1] ?? '').trim()
    const width = value.split(/\s+/)[0] ?? ''
    if (width.startsWith('var(--evo-hairline-') || width === '0' || width === 'none') continue
    findings.push('border: ' + value)
  }
  return findings
}

/** A CSS rule's selector, for the rules written as strings in a client half. */
const CSS_RULE = /'([^'\n]*\{[^'\n]*\})'/g

/** A selector that an interaction can actually reach. */
const INTERACTIVE_SELECTOR = /:(hover|focus|focus-visible|focus-within|active)\b|\[aria-(current|pressed|expanded)|\b(button|input|select|textarea)\s*(?=[:.[,\s{])/

/**
 * N26 (0.15): an INTERACTION colour on a rule no interaction reaches.
 *
 * The panel's state chip borrowed `interactive-bg-active`, which made a fact read as something to
 * click (W9); the same mistake is easy to repeat because the platform's interaction tokens are the
 * most convenient fill in the palette. A static surface takes a layer or a label token instead.
 * @param text - the file's source.
 * @returns one finding per rule that borrows an interaction colour without being interactive.
 */
function interactionColourOffenders(text) {
  const stripped = withoutComments(text)
  const findings = []
  for (const match of stripped.matchAll(CSS_RULE)) {
    const rule = match[1] ?? ''
    const open = rule.indexOf('{')
    const selector = rule.slice(0, open)
    const body = rule.slice(open)
    const borrow = /--dsw-alias-(interactive-bg-[a-z0-9-]+|button-primary-[a-z0-9-]+)/.exec(body)
    if (borrow === null) continue
    if (INTERACTIVE_SELECTOR.test(selector)) continue
    findings.push(selector.trim() + ' uses ' + borrow[0])
  }
  return findings
}

/** A geometry property whose value must come from the scale. */
const GEOMETRY_PROPERTY = /\b(padding|margin|gap|row-gap|column-gap|width|height|min-width|min-height|max-width|max-height|inset|left|top|right|bottom)(?:-(?:top|right|bottom|left))?\s*:\s*([^;'"}\n]+)/g

/**
 * N27 (0.15): geometry written as a pixel literal inside a client half.
 *
 * `font-size` and `color` were already covered (N24); the same drift lived on in shapes — 7px against
 * 6px insets, a 264px column against 280px, radii and gaps that only matched by luck. Scale membership
 * is judged on the STRING, because jsdom resolves neither `var()` nor `calc()`.
 * @param text - the file's source.
 * @returns every declaration that carries a bare pixel length.
 */
function clientGeometryLiterals(text) {
  const stripped = withoutComments(text)
  const findings = []
  for (const match of stripped.matchAll(GEOMETRY_PROPERTY)) {
    const value = (match[2] ?? '').trim()
    if (!/(^|\s)\d+(\.\d+)?px(\s|$)/.test(value)) continue
    findings.push(match[1] + ': ' + value)
  }
  return findings
}

/** A browser half reaching for the host's runtime, which it does not have. */
const NODE_SPECIFIER = /(?:^|[^\w.])((?:node:)?(?:fs|fs\/promises|path|os|child_process|worker_threads|cluster|net|http|https|dns|tls|zlib|stream|crypto|url|util|process))\s*'?/

/** A call that changes bytes on disk. */
const WRITE_CALL = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|truncate|truncateSync|copyFile|copyFileSync|openSync|writeSync|chmod|chmodSync)\s*\(/g

// N29 (0.18): a platform service captured into a binding at the apply body's level. Heuristic
// boundary (single-line, like N3): the statement's indentation is what separates an apply-time
// capture (0-2 spaces) from a per-call read inside a callback body (4+ spaces, which is legal and
// deliberate); a capture written at 2 spaces inside a nested block is a false positive, and one
// indented 4 spaces at apply level is a false negative. The scope is a client half's ENTRY file.
const SERVICE_CAPTURE_RE = /^(?: {0,2}|\t)(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=\n]*=[ \t]*ctx\.get\(/gm

/** The ONE module allowed to define an observable source (N30). */
const OBSERVABLE_OWNER = 'evolution-settings-ui/src/client/source.ts'

/** A snapshot accessor written in a client half: only the owner module may spell one (N30). */
const SNAPSHOT_DEFINITION_RE = /\bgetSnapshot\s*[:=]/g

/** A `hooks` compartment, whose members must reference an owner-built source (N30). */
const HOOKS_COMPARTMENT_RE = /\bhooks\s*:\s*\{([^}]*)\}/g

/**
 * N29 (0.18): a platform service read into a BINDING at the apply body's level, in a client entry.
 *
 * The renderer re-reads a card's data at render time, so a service captured once during apply is read
 * before the settings shell that provides the seat exists. The row that activates first then pins
 * every card to the empty state for the life of its fiber, and nothing logs: `ctx.get` is the
 * optional-service read, and "no seat yet" is a legal answer. Read through a callable probe instead.
 * @param text - the file's source.
 * @returns the captured binding names, in file order.
 */
function platformServiceCaptures(text) {
  const stripped = withoutComments(text)
  return [...stripped.matchAll(SERVICE_CAPTURE_RE)].map(match => match[1])
}

/**
 * N30 (0.18): a hand-rolled observable source inside a client half.
 *
 * `hooks` compartments carry BARE observables; the renderer binds each one to a `use<Name>` hook and
 * caches that binding per SOURCE object, and it compares the snapshot BY REFERENCE. A source built per
 * render therefore re-binds the hook, and a `getSnapshot` that builds an object per call never compares
 * equal — React aborts the card with minified invariant #185 and the slot error boundary replaces it
 * with an empty placeholder. Both facts live in ONE owner module, and a `hooks` member may only
 * reference what that module built.
 * @param text - the file's source.
 * @returns every hand-rolled source and every non-reference hooks member found.
 */
function handRolledSources(text) {
  const stripped = withoutComments(text)
  const findings = (stripped.match(SNAPSHOT_DEFINITION_RE) ?? []).map(() => 'getSnapshot defined outside ' + OBSERVABLE_OWNER)
  for (const match of stripped.matchAll(HOOKS_COMPARTMENT_RE)) {
    for (const member of (match[1] ?? '').split(',')) {
      const part = member.trim()
      if (part === '') continue
      const colon = part.indexOf(':')
      if (colon < 0) {
        findings.push('hooks carries a spread: ' + part)
        continue
      }
      const value = part.slice(colon + 1).trim()
      if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value)) findings.push('hooks member is not a reference: ' + part)
    }
  }
  return findings
}

/**
 * E1 (0.15): a browser half importing a Node builtin, or writing to disk.
 *
 * The client bundle runs in the platform's page, where neither exists: an import would become a
 * runtime failure and a write would land in a sandbox that has no filesystem. The rule is the client
 * half of the family's L2/L3 split — the host owns every byte (E1, §15.2 L3).
 * @param text - the file's source.
 * @returns every specifier and every write call found.
 */
function clientHostOffenders(text) {
  const stripped = withoutComments(text)
  const findings = []
  for (const match of stripped.matchAll(/\bimport\s[^'\n]*'([^'\n]+)'/g)) {
    const specifier = match[1] ?? ''
    if (!/^(node:)?(fs|path|os|child_process|worker_threads|cluster|net|http|https|dns|tls|zlib|stream|crypto|url|util|process)(\/|$)/.test(specifier)) continue
    findings.push('imports ' + specifier)
  }
  for (const match of stripped.matchAll(WRITE_CALL)) findings.push('calls ' + match[1] + '()')
  return findings
}

/** Paren-balanced argument text + top-level comma count (N13a's DI filter). */
function callArgs(text, openParen) {
  let depth = 0
  let commas = 0
  let raw = ''
  for (let i = openParen; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) return { commas, raw }
    } else if (ch === ',' && depth === 1) commas += 1
    if (depth >= 1 && !(depth === 1 && ch === '(')) raw += ch
  }
  return { commas, raw }
}
const squash = (s) => s.replace(/\s+/g, ' ').trim()

/** Comments and string literals are INERT for the delivery rules: prose may
 * name `agent.inject(...)` / `const wake = agent.followup` (the specs, the
 * 0.3.73 write-up and this file's own docblock all do), and only real code can
 * lose a receiver or ride the non-waking primitive. */
const mask = (match) => match.replace(/[^\n]/g, ' ')
const inertText = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, mask)
  .replace(/^[ \t]*\/\/.*$/gm, mask)
  .replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, mask)

/** N12: module-scope mutable state written by the same file. */
function mutableStateBindings(text) {
  const out = []
  for (const match of text.matchAll(MUTABLE_STATE_RE)) {
    const name = match[1]
    if (new RegExp('\\b' + name + '\\.(?:add|set|delete|clear)\\(').test(text)) out.push(name)
  }
  return out
}

/** N14: catch blocks that serve a durable-read failure as absent. */
function swallowCatchKeys(text) {
  const out = []
  for (const match of text.matchAll(CATCH_ABSENT_RE)) {
    let depth = 0
    let body = ''
    for (let i = match.index + match[0].length - 1; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) break
      }
      body += ch
    }
    if (!/return\s+(?:\[\]|null|undefined|false|''|"")\s*;?/.test(body)) continue
    if (/\bthrow\b/.test(body)) continue
    if (/\bisMissing\b|\bENOENT\b|\bcode\s*===/.test(body)) continue
    const tryAt = text.lastIndexOf('try', match.index)
    if (tryAt < 0) continue
    const open = text.indexOf('{', tryAt)
    if (open < 0 || open >= match.index) continue
    let d = 0
    let tryBody = ''
    for (let i = open; i < match.index; i += 1) {
      const ch = text[i]
      if (ch === '{') d += 1
      else if (ch === '}') d -= 1
      else if (d >= 1) tryBody += ch
    }
    if (!DURABLE_READ_RE.test(tryBody)) continue
    out.push('try {' + squash(tryBody).slice(0, 100) + '} catch -> absent')
  }
  return out
}

// N20 (B3 / G4): the single-source table of persisted write sites.
const WRITE_INVENTORY_PATH = 'evolution-core/persisted-write-inventory.json'

/** N20 (B3 / G4): the declared persisted write sites vs the code they describe.
 * Pure over (sites, source reader) so the startup self-test can prove it bites.
 * `readSource(file)` returns the writer's text, or null when the file is gone. */
function inventoryViolations(sites, readSource) {
  const out = []
  if (sites.length === 0) {
    out.push(`${WRITE_INVENTORY_PATH}: declares no write site — the inventory vouches for nothing (a vacuum pass is not a pass)`)
    return out
  }
  const ids = new Set()
  for (const site of sites) {
    const id = typeof site?.id === 'string' ? site.id : '<missing id>'
    if (ids.has(id)) out.push(`${WRITE_INVENTORY_PATH}: duplicate site id "${id}"`)
    ids.add(id)
    const source = readSource(site?.writer)
    if (source === null) {
      out.push(`${WRITE_INVENTORY_PATH}: ${id} names writer ${String(site?.writer)}, which does not exist under ${root}`)
      continue
    }
    if (site.serializedBy === 'instance-claim') {
      if (typeof site.instance !== 'string' || site.instance === '') {
        out.push(`${WRITE_INVENTORY_PATH}: ${id} declares instance-claim without an instance key`)
      } else if (!source.includes('claimInstance(')) {
        out.push(`${WRITE_INVENTORY_PATH}: ${id} declares the instance claim "${site.instance}", but ${site.writer} never calls claimInstance() — the declared serialization is not in the code`)
      }
    } else if (typeof site.marker !== 'string' || !source.includes(site.marker)) {
      out.push(`${WRITE_INVENTORY_PATH}: ${id} declares ${String(site.serializedBy)} with marker ${JSON.stringify(site.marker)}, which ${site.writer} does not contain — the declared serialization is not in the code`)
    }
    for (const key of Array.isArray(site.state) ? site.state : []) {
      if (!MUTABLE_STATE.has(key)) {
        out.push(`${WRITE_INVENTORY_PATH}: ${id} references N12 state key "${key}", which the MUTABLE_STATE registry does not declare`)
      }
    }
  }
  return out
}

let checkedCount = 0

const violations = []
/** N3 (gate, 0.3.25): Config numeric fields must carry a value clamp
 * (`.min(`/`.max(`/`.finite(`/`.nonnegative(`) — schemastery lets NaN and
 * ±Infinity through a bare `z.number()`, so the assembly-time clampedNumber()
 * fallback is the authoritative guard (G3.1). Field-level single-line
 * heuristic: a line containing `z.number()` without any clamp call is a
 * violation. 0.3.23 held the remaining fields as a warn-only TODO; 0.3.25
 * clamped them all (N3 = 0), so the check flipped into the violations gate.
 * */
/** H2 (v11): P0-1-class guard — a probed `evolution[A-Z]\w+` service key
 * must have a provider SOMEWHERE in the tree. doctor probed `evolutionReview`
 * for five releases with zero providers and the self-check silently lied;
 * this catches the next ghost key statically. */
/** N20 reverse (v46 S1.12): every `transactIo(` call site seen during the walk. */
const transactSites = []
const probedEvolutionKeys = new Set()
const providedEvolutionKeys = new Set()
/** N10b (S3.4/A99): every service key the tree probes with `ctx.get(<name>)`, family or platform. */
const probedServiceKeys = new Set()
const PROBE_RE = /(?:\bhas|\.get|ctx\.get)\('(evolution[A-Z]\w+)'\)/g
const PROVIDE_RE = /(?:super\([^)]*,\s*'|\.provide\('|provide\(')(evolution[A-Z]\w+)'/g

/** N8: does one manifest publish `exports['./invariant']`? An unreadable
 * manifest is UNKNOWN (reported), never silently "declares no companion". */
function manifestPublishesInvariant(manifestPath, packageDir) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const exportsMap = manifest.exports
    return exportsMap !== undefined && exportsMap !== null && exportsMap['./invariant'] !== undefined
  } catch (error) {
    violations.push(`${packageDir}/package.json: unreadable manifest (${error instanceof Error ? error.message : String(error)}) — the N8 ./invariant scan cannot decide for this package`)
    return false
  }
}

/** N15 (v46 S2.7): family anchors in EVERY citation surface — Markdown, and the comments of the
 * scripts and sources themselves. The bare `<name>.mjs:42` form is judged only when the basename is
 * UNIQUE in the tree (a bare `index.ts:42` names too many files to mean anything). The guard's own
 * detector samples are not citations, so its file is skipped by name. */
/** N15: family-anchored `path:line` citations (a package segment then the file). */
const FAMILY_ANCHOR_RE = /([A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:ts|mjs|cjs|json|ya?ml))[:：](\d+)(?:[-–,，](\d+))?/g
/** N15 (v46 S2.7): the bare `<name>.mjs:42` form, judged only for unique basenames. */
const BARE_ANCHOR_RE = /\b([A-Za-z0-9_-]+\.(?:ts|mjs|cjs))[:：](\d+)/g
const SELF_REL = 'scripts/verify-arch-guards.mjs'

/** N10b (S3.4/A99): the service keys one source probes with `ctx.get(<name>)` (both quote forms).
 * @param text - one file's source.
 * @returns the probed keys.
 */
function probedServiceKeysIn(text) {
  const out = []
  for (const match of text.matchAll(/ctx\.get\(\s*'([A-Za-z][\w.]*)'\s*\)/g)) out.push(match[1])
  for (const match of text.matchAll(/ctx\.get\(\s*"([A-Za-z][\w.]*)"\s*\)/g)) out.push(match[1])
  return out
}

/** N10b: the service keys core's probe table declares (`{ service: ... }` entries).
 * @param text - `platform-services.ts`.
 * @returns the declared keys, in file order.
 */
function declaredServiceKeysIn(text) {
  const out = []
  for (const match of text.matchAll(/\{\s*service:\s*'([^']+)'/g)) out.push(match[1])
  return out
}

function staleAnchor(anchor, lineCount) {
  return anchor.line > lineCount
}

function docAnchorViolations(dir, packageDirs) {
  const out = []
  const seen = new Set()
  const files = []
  const byBase = new Map()
  const collect = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name)
      if (entry.isDirectory()) {
        // `packages/docs/**` is gitignored history, not a versionable surface (the fact table's
        // own $comment says so): a historical record keeps the anchors it was written with, the
        // same reason CHANGELOG.md is the reason layer. Judging it would ask us to rewrite history.
        if (!SKIP.has(entry.name) && entry.name !== 'docs') collect(path)
        continue
      }
      if (!/\.(md|ts|mjs|cjs)$/.test(entry.name)) continue
      files.push({ path, rel: relative(root, path).split('\\').join('/') })
      if (/\.(ts|mjs|cjs)$/.test(entry.name)) byBase.set(entry.name, (byBase.get(entry.name) ?? 0) + 1)
    }
  }
  collect(dir)
  const judge = (rel, raw, tail, target, anchorLine) => {
    const key = rel + ' :: ' + raw + ' :: ' + anchorLine
    if (seen.has(key)) return
    seen.add(key)
    if (!existsSync(target)) {
      out.push(`${rel}: anchor "${raw}" names no family file (looked for ${tail})`)
      return
    }
    const lineCount = readFileSync(target, 'utf8').split('\n').length
    if (staleAnchor({ line: anchorLine }, lineCount)) {
      out.push(`${rel}: anchor "${raw}" cites line ${anchorLine} of a ${lineCount}-line ${tail} — re-anchor it to the code (symbols do not rot)`)
    }
  }
  for (const { path, rel } of files) {
    if (rel === SELF_REL) continue
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(FAMILY_ANCHOR_RE)) {
      const segments = match[1].split('/').filter(Boolean)
      const at = segments.findIndex(segment => packageDirs.has(segment))
      if (at < 0) continue
      const tail = segments.slice(at).join('/')
      // `<pkg>/<file>` is the single-src shorthand for `<pkg>/src/<file>`.
      let target = join(root, tail)
      if (!existsSync(target) && segments.length - at === 2) target = join(root, segments[at], 'src', segments[at + 1])
      judge(rel, match[0], tail, target, Number(match[3] ?? match[2]))
    }
    for (const match of text.matchAll(BARE_ANCHOR_RE)) {
      if (byBase.get(match[1]) !== 1) continue
      const found = files.find(file => file.path.endsWith('/' + match[1]) || file.path.endsWith('\\' + match[1]))
      if (found === undefined) continue
      judge(rel, match[0], match[1], found.path, Number(match[2]))
    }
  }
  return out
}

/** N16: a read on a registry receiver taken from `ctx.get('skills'|'tools')`
 * with no scope argument. Text-level by design (same posture as N12/N14). */
const SCOPE_RECEIVER_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*ctx\.get\('(?:skills|tools)'\)/g
const SCOPE_READ_REGISTER = new Set([
  'evolution-review/src/index.ts :: registry.get(name)',
])

function scopeLessReadKeys(text) {
  const keys = []
  for (const receiver of [...text.matchAll(SCOPE_RECEIVER_RE)].map(match => match[1])) {
    const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const call of text.matchAll(new RegExp(`${escaped}\\.(list|get)\\(([^()]*)\\)`, 'g'))) {
      const args = (call[2] ?? '').trim()
      const commas = args === '' ? 0 : args.split(',').length - 1
      const scopeLess = call[1] === 'list' ? args === '' : commas === 0
      if (scopeLess) keys.push(`${receiver}.${call[1]}(${args})`)
    }
  }
  return keys
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue
      walk(path)
    } else if (entry.name.endsWith('.ts')) {
      checkedCount += 1
      const rel = relative(root, path).split('\\').join('/')
      const text = readFileSync(path, 'utf8')
      // N20 reverse (v46 S1.12): remember transactional write call sites so the inventory can be
      // judged in both directions once the walk is over.
      if (rel.includes('/src/')) {
        for (const match of text.matchAll(/transactIo\(/g)) {
          transactSites.push({ rel, fragment: text.slice(match.index, match.index + 90) })
        }
      }
      // H2 (v11): collect probe/provider pairs for the ghost-key check.
      for (const match of text.matchAll(PROBE_RE)) probedEvolutionKeys.add(match[1])
      // Production probes only: the shipped table describes what the PLUGIN reaches for (a spec that
      // fakes `ctx.get('commands')` is not a capability the family uses).
      if (!rel.includes('/tests/')) {
        for (const key of probedServiceKeysIn(text)) probedServiceKeys.add(key)
      }
      for (const match of text.matchAll(PROVIDE_RE)) providedEvolutionKeys.add(match[1])
      // N1: production routing — only files under a package's src/ are
      // checked, so test fixtures that set DSH_HOME for an isolated home are
      // not treated as single-source drift.
      if (rel.includes('/src/') && DSH_HOME_RE.test(text) && !rel.startsWith(`${CORE_SRC}/`)) {
        violations.push(`${rel}: reads process.env.DSH_HOME outside ${CORE_SRC} (route through core's home resolver)`)
      }
      // N2: any local copy outside the canonical authority (approval, then core).
      if (rel.includes('/src/') && COPY_RE.test(text) && !rel.startsWith(`${APPROVAL_SRC}/`) && !rel.startsWith(`${CORE_SRC}/`)) {
        violations.push(`${rel}: local copy of ApprovalPolicyLike/effectiveSessionPolicy (single-source in ${APPROVAL_SRC})`)
      }
      // N3 (gate): bare Config numeric fields (see comment above).
      // P2-40 (v11) heuristic boundary: single-LINE scanning only — a
      // chained `z.number()\n  .min(1)` is a FALSE POSITIVE on its first
      // line, and block comments/string literals are NOT stripped (a
      // `z.number()` in prose still flags). The repo's current single-line
      // style keeps both at zero; change the scanning if the style changes.
      if (rel.includes('/src/')) {
        // The line scan (and its single-line boundary) lives in unclampedNumericFieldLines.
        for (const line of unclampedNumericFieldLines(text)) {
          violations.push(`${rel}:${line}: numeric field without a value clamp (route through clampedNumber + a .min/.max schema bound)`)
        }
      }
      // N5 (v39): kernel import direction.
      if (rel.startsWith(`${CORE_SRC}/`)) {
        for (const match of text.matchAll(FAMILY_IMPORT_RE)) {
          if (CORE_ALLOWED_FAMILY.has(match[1])) continue
          violations.push(`${rel}: evolution-core must not import ${match[1]} (the kernel reaches only the L0 seams)`)
        }
      }
      // N6 (v39): composition bundles must reduce to imports / re-exports /
      // `export {}`. The invariant.ts exclusion was dropped once I-3 (S2.1)
      // deleted the 29 empty installers.
      if (BUNDLE_PKGS.has(rel.split('/')[0] ?? '') && rel.includes('/src/')) {
        if (bundleRuntimeResidue(text) !== '') {
          violations.push(`${rel}: composition bundle carries runtime code (bundles own YAML rows only)`)
        }
      }
      // N7 (v39, S3.1): SkillLibrary construction site.
      if (rel.includes('/src/') && SKILL_LIBRARY_RE.test(text) && !rel.startsWith(`${CORE_SRC}/`) && !SKILL_LIBRARY_TODO.has(rel)) {
        violations.push(`${rel}: new SkillLibrary(...) outside core's newSkillLibrary() helper (root/limits parsing is single-sourced) — build it with newSkillLibrary({ config, io, limits?, ctx?, threatExemptLabels? })`)
      }
      // N10 (v39, S3.4 rule ④): new platform service probe — see docblock.
      {
        const unanchored = unanchoredPlatformProbes(text, rel, PLATFORM_GET_BASELINE.get(rel) ?? 0)
        if (unanchored > 0) {
          violations.push(`${rel}: ${unanchored} new ctx.get('<platform service>') probe(s) with no platform-declaration anchor in the file (cite the platform declaration; baseline lives in PLATFORM_GET_BASELINE)`)
        }
      }
      // N11 (v37 P7a): ONE reader for the platform dispatch vocabulary — see
      // the docblock entry. Literals inside comments and string values are
      // inert, so the raw text is stripped first; a match therefore means the
      // file really compares or passes a dispatch event type.
      if (rel !== DISPATCH_GUARD_MODULE && !DISPATCH_GUARD_TEST_SUFFIXES.some(suffix => rel.endsWith(suffix))) {
        const sites = dispatchVocabularySites(text).length
        if (sites > 0) {
          violations.push(`${rel}: ${sites} platform dispatch event-type match(es) outside ${DISPATCH_GUARD_MODULE} (one vocabulary per dispatch mode; match ToolDispatchSignal.kind instead)`)
        }
      }
      // N12 (P5): module-scope mutable process state must be registered.
      // Known blind spot (documented; upgrade path = AST): state declared inside
      // a plugin's `apply()` body is invisible to a line rule — the family's
      // largest cluster (evolution-review's eight registered per-session
      // collections plus reviewInFlight / the one-shot warn flags /
      // deferredFallbackReviews) lives there.
      if (rel.includes('/src/')) {
        for (const name of mutableStateBindings(text)) {
          const key = `${rel} :: ${name}`
          if (!MUTABLE_STATE.has(key)) {
            violations.push(`${rel}: ${name} is module-scope mutable process state with no registration — add this key to MUTABLE_STATE with its platform gap, lifecycle owner, evidence anchor and validity domain: ${key}`)
          }
        }
      }
      // N13a (P5): a must-execute payload may not ride the non-waking primitive.
      if (rel.includes('/src/')) {
        for (const match of inertText(text).matchAll(AGENT_INJECT_RE)) {
          const receiver = (match[1] ?? '').split('.').pop() ?? ''
          if (/^ctx$/i.test(receiver) || /Ctx$/.test(receiver)) continue // cordis DI
          // The CLIENT slot registry spells its registration `slots.inject(name, cb)`
          // (S4.4): it contributes a component to a declared slot and delivers no
          // payload to any session, so it is not the non-waking primitive this rule
          // is about. Agent delivery keeps its own receiver name (`agent`,
          // `invocation.agent`), which stays flagged.
          if (receiver === 'slots') continue
          const open = match.index + match[0].length - 1
          const args = callArgs(text, open)
          if (/^\s*\[/.test(args.raw)) continue // inject(['dep'], cb) is DI
          const key = `${rel} :: ${match[1]}.inject(${squash(args.raw)})`
          if (!INJECT_SITES.has(key)) {
            violations.push(`${rel}: must-execute payload on the non-waking primitive — either wake it (agent.followup / deliverEnsuringWake) or register the debt in INJECT_SITES with this key: ${key}`)
          }
        }
      }
      // N13b (P5 / 0.3.73): the wake primitive must be called on its receiver.
      for (const key of wakeLocalKeys(inertText(text))) {
        violations.push(`${rel}: wake primitive read into a local (${squash(key)}) — the platform Agent methods are prototype methods that call this.send; call agent.followup(...) / agent.steer(...) on the receiver (0.3.73 receiver loss)`)
      }
      // N14 (P5): a durable-read failure must not be served as absent.
      if (rel.includes('/src/')) {
        for (const key of swallowCatchKeys(text)) {
          const full = `${rel} :: ${key}`
          // Exact match only (F3, v41 phase-1 review): the register's grain is
          // ONE site, so a prefix must never exempt a new neighbour silently.
          // A deliberate family is written with a trailing `*` and is then —
          // and only then — a wildcard.
          const registered = SWALLOW_CATCH.has(full)
            || [...SWALLOW_CATCH.keys()].some(entry => entry.endsWith('*') && full.startsWith(entry.slice(0, -1)))
          if (!registered) {
            violations.push(`${rel}: ${key} — a durable-read failure is served as absent; register it in SWALLOW_CATCH with this key: ${full}`)
          }
        }
      }
      // N16 (v41): scope-less platform registry read — see docblock.
      if (rel.includes('/src/')) {
        for (const key of scopeLessReadKeys(text)) {
          const full = `${rel} :: ${key}`
          if (SCOPE_READ_REGISTER.has(full)) continue
          violations.push(`${rel}: ${key} — a scope-less platform registry read sees the GLOBAL layer alone; ask in the calling scope via callingScope(ctx), or register a deliberate global read: ${full}`)
        }
      }
      // N17 (0.3.77): modality-blind accounting — see docblock.
      if (rel !== DISPATCH_KIND_OWNER && rel.includes('/src/')) {
        for (const key of modalityBranchKeys(text)) {
          const full = `${rel} :: ${key}`
          if (MODALITY_BRANCH_REGISTER.has(full)) continue
          violations.push(`${rel}: ${key} — a consumer must not branch on the dispatch modality; read the names/counts (skillReadNameOf / countDispatches) or register the branch in MODALITY_BRANCH_REGISTER with its reason: ${full}`)
        }
      }
      // N18 (0.3.77): the session-scoped stream is opt-in gated — see docblock.
      if (rel.includes('/src/')) {
        for (const key of ungatedSessionStreamKeys(text)) {
          const full = `${rel} :: ${key}`
          if (SESSION_GATE_REGISTER.has(full)) continue
          violations.push(`${rel}: ${key} — a session/event consumer must consult the opt-in gate; call sessionAudited(ctx, session.id, config.sessionScoped) at the top of the listener, or register the deliberate exception in SESSION_GATE_REGISTER: ${full}`)
        }
      }
      // N21 (C2, 0.8.0): error codes are spelled once — see the docblock.
      if (rel !== ERROR_TABLE_OWNER && rel.includes('/src/')) {
        for (const code of errorCodeLiterals(text)) {
          violations.push(`${rel}: the message for ${code} is spelled here — the family's error-code table owns it (rule N21); render it with errorText(...)`)
        }
      }
      // N22 (C3, 0.8.0): the namespace comes from the registry — see the docblock.
      if (rel.includes('/src/')) {
        for (const split of namespaceSplits(text)) {
          violations.push(`${rel}: settings namespace spelled here (${split}) — the owner → namespace map in evolution-core owns it (rule N22); read it with paramNamespace(owner)`)
        }
      }
      // N34 (S2.9/T3-10): the settings user layer has ONE reader — see the docblock.
      if (rel.includes('/src/') && rel !== `${CORE_SRC}/params.ts`) {
        for (const read of settingsUserLayerReads(text)) {
          violations.push(`${rel}: reads the settings user layer here (${read}) — evolution-core's params.ts owns that read (rule N34); call userSetKeys(ctx, paramRowId(<owner>))`)
        }
      }
      // N35 (S2.9, T2-08/A23 follow-up): platform line-cites are frozen — see the docblock.
      if (!rel.startsWith('docs/')) {
        const cites = platformCiteSites(root, text)
        const allowed = PLATFORM_CITE_BASELINE.get(rel) ?? 0
        if (cites.length > allowed) {
          violations.push(`${rel}: ${cites.length - allowed} NEW platform file:line citation(s) (${cites.slice(0, 3).join(', ')}) — another repository's line numbers rot at every bump and nothing here can re-derive them (rule N35); cite the symbol instead. Frozen baseline for this file: ${allowed}`)
        }
      }
      // N36 (S3.2, audit 1-2/A101): the expression form of the N14 swallow — see the docblock.
      {
        const swallowed = swallowedReadSites(text)
        const allowedSwallows = SWALLOWED_READ_BASELINE.get(rel) ?? 0
        if (swallowed.length > allowedSwallows) {
          violations.push(`${rel}: ${swallowed.length - allowedSwallows} NEW read failure(s) served as absent (line ${swallowed.join(', ')}) — a durable read's failure is not "absent" (rule N36); read it with probeText/probeList/probeMtime. Frozen baseline for this file: ${allowedSwallows}`)
        }
      }
      // N23 (C5/B13, 0.8.0): raw durable-file writes live in the IO seam — see docblock.
      if (rel.includes('/src/') && !IO_SEAM_WRITERS.has(rel) && !RAW_WRITE_REGISTER.has(rel)) {
        for (const api of fsWriteImports(text)) {
          violations.push(`${rel}: imports \`${api}\` — a durable-file write outside the IO seam skips the lock/transaction protocol (rule N23); route it through ctx.evolutionIo, or register the writer with its reason`)
        }
      }
      // N9 (v39, S0.4 invariant): splitter ⊇ finding — see docblock.
      if (rel === `${CORE_SRC}/threats.ts`) {
        for (const match of text.matchAll(REGEXP_CLASS_RE)) {
          const body = match[1] ?? ''
          if (!FORMAT_CLASS_TOKEN_RE.test(body)) continue
          if (body.includes('FORMAT_CONTROL_CLASS')) continue
          violations.push(`${rel}: character class [${body}] hardcodes format-control code points — build it from FORMAT_CONTROL_CLASS so the obfuscation splitter stays a superset of the detector (S0.4 invariant)`)
        }
      }
    }
  }
}

/** Startup self-checks (P5): the registry, its docblock inventory, and every
 * detector must prove themselves before the tree is judged. A rule whose
 * detector silently matches nothing is worse than no rule: it reports a pass
 * (the F-103 vacant-guard class, one level up). */
if (process.argv.includes('--list-rules')) {
  for (const rule of RULES) {
    const sample = rule.sample === 'detector' ? 'sample' : `PENDING ${rule.sampleExpiry}`
    console.log(`${rule.id}: [${sample}] ${rule.title}`)
  }
  const pending = RULES.filter(rule => rule.sample !== 'detector').map(rule => rule.id)
  console.log(`verify-arch-guards: ${RULES.length - pending.length}/${RULES.length} rule(s) carry a detector sample` + (pending.length > 0 ? ` — pending: [${pending.join(', ')}]` : ''))
  process.exit(0)
}
{
  const incomplete = []
  for (const rule of RULES) {
    for (const field of ['title', 'incident', 'canonicalForm', 'vacuity']) {
      if (typeof rule[field] !== 'string' || rule[field].trim() === '') incomplete.push(`${rule.id}.${field}`)
    }
    if (rule.sample === 'detector') continue
    if (rule.sample !== 'pending') incomplete.push(`${rule.id}.sample`)
    else if (typeof rule.sampleExpiry !== 'string' || rule.sampleExpiry.trim() === '') incomplete.push(`${rule.id}.sampleExpiry`)
  }
  if (incomplete.length > 0) {
    console.error(`verify-arch-guards: rule metadata incomplete — [${incomplete.join(', ')}] (a rule without an incident, a canonical form and a stated proof of non-vacuity is not a rule)`)
    process.exit(1)
  }
  const incompleteRegister = GUARD_VACUITY.flatMap(entry => ['guard', 'emptyInput', 'expiry', 'evidence']
    .filter(field => typeof entry[field] !== 'string' || entry[field].trim() === '')
    .map(field => `${entry.guard ?? '?'}.${field}`))
  if (incompleteRegister.length > 0) {
    console.error(`verify-arch-guards: guard-vacuity register incomplete — [${incompleteRegister.join(', ')}] (name the guard, the empty input, the expiry step and the evidence)`)
    process.exit(1)
  }
  const selfText = readFileSync(new URL(import.meta.url), 'utf8')
  const documented = new Set([...selfText.matchAll(/^ \*   (N\d+[a-z]?|H2)\./gm)].map(match => match[1]))
  const undocumented = RULES.filter(rule => !documented.has(rule.id)).map(rule => rule.id)
  const unregistered = [...documented].filter(id => !RULES.some(rule => rule.id === id))
  if (undocumented.length > 0 || unregistered.length > 0) {
    console.error(`verify-arch-guards: rule inventory mismatch — undocumented: [${undocumented.join(', ')}], unregistered: [${unregistered.join(', ')}] (the docblock and RULES must list the same ids)`)
    process.exit(1)
  }

  const detectors = [
    // F1 discipline: every sample asserts the INCIDENT shape(s) the rule exists for
    // AND at least one clean shape it must not bite (see the N13b note below).
    ['N1', () => DSH_HOME_RE.test('const home = process.env.DSH_HOME')
      && DSH_HOME_RE.test('const home = process.env[\'DSH_HOME\']')
      && !DSH_HOME_RE.test('const home = resolveDshHome(options)')],
    ['N2', () => COPY_RE.test('interface ApprovalPolicyLike {')
      && COPY_RE.test('function effectiveSessionPolicy(config) {')
      && !COPY_RE.test('import type { ApprovalPolicyLike } from \'@deepseek-ai/dsh-evolution-approval\'')],
    ['N3', () => unclampedNumericFieldLines('const a = z.number()').length === 1
      && unclampedNumericFieldLines('const b = z.number().min(1).max(9)').length === 0
      && unclampedNumericFieldLines('// prose: z.number() with no bound').length === 0],
    ['H2', () => ghostServiceKeys(['evolutionReview'], new Set()).length === 1
      && ghostServiceKeys(['evolutionIo'], new Set(['evolutionIo'])).length === 0],
    ['N5', () => [...'import x from \'@deepseek-ai/dsh-evolution-review\''.matchAll(FAMILY_IMPORT_RE)].filter(m => !CORE_ALLOWED_FAMILY.has(m[1])).length === 1
      && [...'import x from \'@deepseek-ai/dsh-evolution-state-storage\''.matchAll(FAMILY_IMPORT_RE)].filter(m => !CORE_ALLOWED_FAMILY.has(m[1])).length === 0],
    ['N6', () => bundleRuntimeResidue('import x from \'y\'\nexport {}') === ''
      && bundleRuntimeResidue('export const LOADER = 1') !== ''
      && bundleRuntimeResidue('// prose only\nexport * from \'y\'') === ''],
    ['N7', () => SKILL_LIBRARY_RE.test('const lib = new SkillLibrary({ root })')
      && !SKILL_LIBRARY_RE.test('const lib = newSkillLibrary({ root })')],
    ['N8', () => isInvariantCompanion(true, false) && isInvariantCompanion(false, true) && !isInvariantCompanion(false, false)],
    ['N9', () => [...'new RegExp(`[\\p{Cf}]`)'.matchAll(REGEXP_CLASS_RE)].length === 1
      && FORMAT_CLASS_TOKEN_RE.test('\\p{Cf}')
      && !FORMAT_CLASS_TOKEN_RE.test('a-z0-9')
      && [...'new RegExp(`[FORMAT_CONTROL_CLASS]`)'.matchAll(REGEXP_CLASS_RE)].length === 1],
    ['N10', () => unanchoredPlatformProbes('ctx.get(\'tools\')', 'pkg/src/a.ts', 0) === 1
      && unanchoredPlatformProbes('// platform-declaration anchor: tools\nctx.get(\'tools\')', 'pkg/src/a.ts', 0) === 0
      && unanchoredPlatformProbes('ctx.get(\'tools\')', 'pkg/src/a.ts', 1) === 0
      && unanchoredPlatformProbes('ctx.get(\'tools\')', 'pkg/tests/a.ts', 0) === 0
      && probedServiceKeysIn("const t = ctx.get('tools')").join() === 'tools'
      && probedServiceKeysIn('const w = ctx.get("webServer")').join() === 'webServer'
      && probedServiceKeysIn('// prose: ctx.get(\'tools\') is named but not called').length === 1
      && declaredServiceKeysIn("{ service: 'tools', feature: 'x', side: 'host' },").join() === 'tools'
      && declaredServiceKeysIn('const services = new Set()').length === 0],
    ['N11', () => dispatchVocabularySites('if (event.type === \'tool/call\') return').length === 1
      && dispatchVocabularySites('// prose: tool/call is the dispatch type').length === 0
      && dispatchVocabularySites('const label = \'a long prose string that happens to mention tool/call inside it\'').length === 0
      && dispatchVocabularySites('if (kind === NATIVE_CALL_EVENT) return').length === 1],
    ['N16', () => scopeLessReadKeys("const r = ctx.get('tools')\nr.get(name)").length === 1
      && scopeLessReadKeys("const r = ctx.get('tools')\nr.get(name, scope)").length === 0
      && scopeLessReadKeys("const c = ctx.get('skills')\nc.list({ scope })").length === 0
      && scopeLessReadKeys("const c = ctx.get('skills')\nc.list()").length === 1],
    ['N17', () => modalityBranchKeys("if (dispatch.kind === 'program') return").length === 1
      && modalityBranchKeys("if (signal.kind !== 'native') return").length === 1
      && modalityBranchKeys("if ('program-root' === record.kind) return").length === 1
      && modalityBranchKeys("const route = dispatch.kind === 'program' ? 'program' : 'direct'").length === 1
      && modalityBranchKeys("if (dispatch.name === 'skill') return").length === 0
      && modalityBranchKeys("// a PTC session logs dispatch.kind === 'program' in prose only").length === 0],
    ['N18', () => ungatedSessionStreamKeys("ctx.on('session/event', (session, event) => {})").length === 1
      && ungatedSessionStreamKeys("ioCtx.on('session/event', () => {})").length === 1
      && ungatedSessionStreamKeys("ctx.on('session/event', (session) => {\n  if (!sessionAudited(ctx, session.id, config.sessionScoped)) return\n})").length === 0
      && ungatedSessionStreamKeys("// prose only: ctx.on('session/event' is the platform's stream").length === 0
      && ungatedSessionStreamKeys("ctx.on('tool/result', () => {})").length === 0],
    ['N15', () => [...'see evolution-core/src/x.ts:42'.matchAll(FAMILY_ANCHOR_RE)].length === 1 && staleAnchor({ line: 42 }, 10) && !staleAnchor({ line: 9 }, 10)],
    ['N12', () => mutableStateBindings('const bad = new Set()\nbad.add(1)\n').length > 0],
    ['N13a', () => [...'agent.inject(message)'.matchAll(AGENT_INJECT_RE)].length > 0],
    // F1 discipline (v41 phase-1 review): a self-test sample must be an
    // INCIDENT shape, never the simplest spelling the detector happens to
    // match — the bare `const wake = agent.followup` sample passed while the
    // asserted and destructured forms (the ones that actually shipped) were
    // missed. Every rule's probe therefore asserts every known-bad shape AND
    // one clean shape.
    ['N13b', () => wakeLocalKeys('const followup = (agent as { followup?: (m: unknown) => void }).followup').length > 0
      && wakeLocalKeys('const { inject } = invocation.agent').length > 0
      && wakeLocalKeys('const wake = await runtime.steer as unknown as (m: string) => void').length > 0
      && wakeLocalKeys('wake.followup(message)').length === 0
      && wakeLocalKeys('agent.followup(message)').length === 0
      && wakeLocalKeys('const ok = await agent.followup(message)').length === 0
      && wakeLocalKeys("const woke = typeof (invocation.agent as { followup?: unknown }).followup === 'function'").length === 0
      && wakeLocalKeys("const bad = typeof agent.followup === 'function' ? agent.followup : null").length > 0],
    ['N14', () => swallowCatchKeys('try {\n  const x = await readFile(p)\n} catch {\n  return []\n}\n').length > 0],
    // Each sample is the incident shape the rule exists for: an empty table, an
    // unnamed fact, a fact with no home, a fact with nothing to check.
    ['N19', () => factTableProblems({ facts: [] }).length > 0
      && factTableProblems({ facts: [{ id: 'x', home: 'README.md', must: [{ text: 't' }] }] }).length === 0
      && factTableProblems({ facts: [{ id: 'x', must: [{ text: 't' }] }] }).length > 0
      && factTableProblems({ facts: [{ id: 'x', home: 'README.md' }] }).length > 0
      && factTableProblems({ facts: [{ home: 'README.md', must: [{ text: 't' }] }] }).length > 0],
    // N20 follows the same discipline: every shape the rule must bite (a writer
    // with the wrong serialization, a claim nobody makes, a dangling N12 key, a
    // writer that is gone, an empty table) AND one shape it must pass.
    ['N20', () => inventoryViolations([{ id: 'x', writer: 'a.ts', serializedBy: 'transact', marker: 'transactIo(' }], () => 'const plain = 1').length === 1
      && inventoryViolations([{ id: 'x', writer: 'a.ts', serializedBy: 'transact', marker: 'transactIo(' }], () => 'await transactIo(io, p, task)').length === 0
      && inventoryViolations([], () => '').length === 1
      && inventoryViolations([{ id: 'c', writer: 'a.ts', serializedBy: 'instance-claim', instance: 'k' }], () => 'claimInstance(home, key, owner)').length === 0
      && inventoryViolations([{ id: 'c', writer: 'a.ts', serializedBy: 'instance-claim', instance: 'k' }], () => 'no claim here').length === 1
      && inventoryViolations([{ id: 'c', writer: 'a.ts', serializedBy: 'instance-claim' }], () => 'claimInstance(').length === 1
      && inventoryViolations([{ id: 's', writer: 'a.ts', serializedBy: 'transact', marker: 'transactIo(', state: ['a.ts :: ghost'] }], () => 'transactIo(').length === 1
      && inventoryViolations([{ id: 's', writer: 'gone.ts', serializedBy: 'transact', marker: 'x' }], () => null).length === 1],
    ['N21', () => errorCodeLiterals("return err('E-305: nope')").length === 1
      && errorCodeLiterals("throw new Error(\"E-301: approval service not mounted\")").length === 1
      && errorCodeLiterals('// prose: this branch answers E-305 the same way').length === 0
      && errorCodeLiterals("const ok = errorText('e-305-this-invocation-carries-no')").length === 0],
    ['N36', () => swallowedReadSites('const x = await io.readText(p).catch(() => null)').length === 1
      && swallowedReadSites('const y = await this.io.readText(full).catch(() => undefined)').length === 1
      && swallowedReadSites('await io.remove(p).catch(() => {})').length === 0
      && swallowedReadSites('const z = await io.readText(p)').length === 0
      // Text-level by design (same posture as N14/N35): prose that merely NAMES the shape is not a
      // hit (no dotted call), while a commented-out call IS one — the rule cannot tell it from code.
      && swallowedReadSites('// prose only: readText(p).catch(() => null) is the shape this rule names').length === 0
      && swallowedReadSites('// io.readText(p).catch(() => null) is commented out here').length === 1],
    ['N35', () => platformCiteSites('/nonexistent-root', '// see core/io.ts:475 for the protocol').length === 1
      && platformCiteSites('/nonexistent-root', '// prose without a citation').length === 0
      // No third sample: whether a FAMILY anchor resolves depends on the root under test (the
      // sentry spec runs this against a sandbox copy), so that property is proven by the real-tree
      // run instead — the register only stays quiet when every family path in it resolves.
      && platformCiteSites('/nonexistent-root', '// the protocol lives in core, no path cited').length === 0],
    ['N34', () => settingsUserLayerReads('return new Set(Object.keys(entry?.user ?? {}))').length === 1
      && settingsUserLayerReads("const entry = settings?.describe?.({ redactSecrets: false }).find(item => item.ns === paramRowId('x'))").length === 0
      && settingsUserLayerReads('// prose: the user layer is read once, in core').length === 0],
    ['N22', () => namespaceSplits("export const CURATOR_SETTINGS_NAMESPACE = 'evolution-curator'").length === 1
      && namespaceSplits("PARAM_NAMESPACES['evolution-curator'] ?? CURATOR_SETTINGS_NAMESPACE").length === 1
      && namespaceSplits("const ns = paramNamespace('evolution-curator')").length === 0
      && namespaceSplits("  'evolution-curator': 'evolution-curator',").length === 0],
    // The four SHAPES the first version of this rule missed (0.8.0 review): an API that
    // writes only when called a certain way, the promise face under an alias, the same
    // module without the `node:` prefix, and the dynamic forms.
    ['N23', () => fsWriteImports("import { readFileSync, writeFileSync } from 'node:fs'").join() === 'writeFileSync'
      && fsWriteImports("import { rename } from 'node:fs/promises'").length === 1
      && fsWriteImports("import * as fs from 'node:fs'").join().includes('(namespace)')
      && fsWriteImports("import { existsSync, readdirSync, lstat } from 'node:fs'").length === 0
      && fsWriteImports("import type { Dirent } from 'node:fs'").length === 0
      && fsWriteImports("import { type Dirent, readdirSync } from 'node:fs'").length === 0
      && fsWriteImports("import { open } from 'node:fs/promises'").join() === 'open'
      && fsWriteImports("import { promises as fsp } from 'node:fs'").join() === 'promises'
      && fsWriteImports("import { writeFileSync } from 'fs'").join() === 'writeFileSync'
      && fsWriteImports("import { openSync, writeSync } from 'node:fs'").join() === 'openSync,writeSync'
      && fsWriteImports("const fs = await import('node:fs')").join() === '<dynamic> node:fs'
      && fsWriteImports("const fs = require('fs')").join() === '<dynamic> fs'
      && fsWriteImports("import { readFileSync } from 'fs'").length === 0
      && fsWriteImports("import { readFile } from './io.ts'").length === 0],
    ['N24', () => clientStyleLiterals("'.x{font-size:13px}'").length === 1
      && clientStyleLiterals("'.x{font-size:var(--dsh-content-font-size-secondary,13px)}'").length === 0
      && clientStyleLiterals("'.x{font-size:calc(1em - 1px)}'").length === 0
      && clientStyleLiterals("'.x{font-family:monospace}'").length === 1
      && clientStyleLiterals("'.x{color:#ff0000}'").length === 1
      && clientStyleLiterals("'.x{color:rgb(1,2,3)}'").length === 1
      && clientStyleLiterals("'.x{font:inherit;color:var(--dsw-alias-label-primary)}'").length === 0
      && clientStyleLiterals('// no font-size here\nconst x = 1').length === 0],
    ['N25', () => clientScaleLiterals("'.x{border-radius:6px}'").length === 1
      && clientScaleLiterals("'.x{border-radius:var(--evo-radius-control)}'").length === 0
      && clientScaleLiterals("'.x{border-radius:50%}'").length === 0
      && clientScaleLiterals("'.x{border:0}'").length === 0
      && clientScaleLiterals("'.x{border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}'").length === 0
      && clientScaleLiterals("'.x{border-top:.5px solid var(--dsw-alias-border-l2)}'").length === 1
      && clientScaleLiterals("'.x{border-color:var(--dsw-alias-border-l2)}'").length === 0
      && clientScaleLiterals("'.x{border-left-width:var(--evo-hairline-marker)}'").length === 0],
    ['N26', () => interactionColourOffenders("'.chip{background:var(--dsw-alias-interactive-bg-active)}'").length === 1
      && interactionColourOffenders("'.x:hover{background:var(--dsw-alias-interactive-bg-hover)}'").length === 0
      && interactionColourOffenders("'.x[aria-current=true]{background:var(--dsw-alias-interactive-bg-active)}'").length === 0
      && interactionColourOffenders("'.card-button[data-primary=true]{background:var(--dsw-alias-button-primary-fill)}'").length === 0
      && interactionColourOffenders("'.x{background:var(--dsw-alias-bg-layer-2)}'").length === 0],
    ['N27', () => clientGeometryLiterals("'.x{padding:7px 8px}'").length === 1
      && clientGeometryLiterals("'.x{padding:var(--evo-space-6) var(--evo-space-8)}'").length === 0
      && clientGeometryLiterals("'.x{max-width:calc(var(--evo-measure-read) * 1.5)}'").length === 0
      && clientGeometryLiterals("'.x{margin:0 0 var(--evo-space-2)}'").length === 0
      && clientGeometryLiterals("'.x{margin-top:.15em}'").length === 0
      && clientGeometryLiterals("'.x{height:var(--evo-space-20)}'").length === 0],
    ['N28', () => clientHostOffenders("import { readFileSync } from 'node:fs'").length === 1
      && clientHostOffenders("import { join } from 'node:path'").length === 1
      && clientHostOffenders("import { createElement } from 'react'").length === 0
      && clientHostOffenders("import { renderMarkdown } from './markdown.ts'").length === 0
      && clientHostOffenders("await writeFile(target, bytes)").length === 1
      && clientHostOffenders('const text = readFile(path)').length === 0],
    // N29: the INCIDENT shape (a seat captured in the apply body) AND the two shapes that must pass —
    // the callable probe that replaced it, and a per-call read inside a callback body.
    ['N29', () => platformServiceCaptures("  const configForms = ctx.get('configForms') as ConfigFormsSeat | undefined").length === 1
      && platformServiceCaptures("  const probe: SeatProbe = (): ConfigFormsSeat | undefined => ctx.get('configForms') as ConfigFormsSeat | undefined").length === 0
      && platformServiceCaptures("    const seat = ctx.get('configForms')\n    if (seat === undefined) return").length === 0
      && platformServiceCaptures("//  const configForms = ctx.get('configForms') in prose only").length === 0
      && platformServiceCaptures("const seam = ctx as unknown as ClientSeam").length === 0],
    // N30: the incident shape (a source object built inline), the reference form that must pass, and
    // the same mistake written as a call inside the compartment.
    ['N30', () => handRolledSources("const source = { getSnapshot: () => ({ value: 1 }), subscribe: () => () => {} }").length > 0
      && handRolledSources("hooks: { paramSection: source }").length === 0
      && handRolledSources("hooks: { paramSection: sources.sourceFor('memory-files') }").length > 0
      && handRolledSources('hooks: { ...spread }').length > 0
      && handRolledSources('// hooks: { paramSection: buildOne() } in prose only').length === 0],
  ]
  const broken = detectors.filter(([, probe]) => !probe()).map(([id]) => id)
  if (broken.length > 0) {
    console.error(`verify-arch-guards: detector self-test failed for [${broken.join(', ')}] — the rule would pass vacuously; fix the detector before trusting this run`)
    process.exit(1)
  }
}

walk(root)
// N15 runs as a whole-tree pass (Markdown, not the per-.ts detectors above).
violations.push(...docAnchorViolations(root, new Set(readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'package.json')))
  .map(entry => entry.name))))

// N19 runs as a whole-tree pass as well (Markdown + the single-source table).
const docFacts = docFactViolations(root)
violations.push(...docFacts.violations)
const docFactSummary = formatDocFacts(docFacts, root)
console.log(`verify-arch-guards: ${docFactSummary}`)

// N20 runs as a whole-tree pass as well (the inventory table + its writers).
// It arms on the TABLE's presence: a malformed or empty table is a violation,
// while a tree without one gets a note (the guard-scripts fixtures build
// synthetic trees). A DELETED table is not left to this note — the table is
// load-bearing: evolution-core/src/write-inventory.ts reads it at import and
// throws, and write-inventory.spec.ts pins it non-empty, so removing it fails
// the family's own suite before any gate runs.
let writeInventoryCount = 0
{
  const inventoryFile = join(root, WRITE_INVENTORY_PATH)
  let sites = null
  try {
    const parsed = JSON.parse(readFileSync(inventoryFile, 'utf8'))
    if (Array.isArray(parsed)) sites = parsed
    else violations.push(`${WRITE_INVENTORY_PATH}: the table is not an array of write sites`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (existsSync(inventoryFile)) violations.push(`${WRITE_INVENTORY_PATH}: unreadable (${reason}) — N20 cannot decide for this tree`)
    else console.log(`verify-arch-guards: N20 not armed: no ${WRITE_INVENTORY_PATH} under ${root}`)
  }
  if (sites !== null) {
    writeInventoryCount = sites.length
    violations.push(...inventoryViolations(sites, (file) => {
      if (typeof file !== 'string') return null
      const path = join(root, file)
      return existsSync(path) ? readFileSync(path, 'utf8') : null
    }))
    // Reverse direction (v46 S1.12, finding 1-7 / fixture A10): the forward check proves every
    // DECLARED site's marker still exists; nothing proved the converse, so a file that gained a
    // second transactional write stayed green while the inventory vouched for one of them.
    const markersByWriter = new Map()
    for (const site of sites) {
      if (typeof site?.writer !== 'string' || typeof site?.marker !== 'string') continue
      markersByWriter.set(site.writer, [...(markersByWriter.get(site.writer) ?? []), site.marker])
    }
    for (const { rel, fragment } of transactSites) {
      if (rel === `${CORE_SRC}/io.ts`) continue // the seam itself defines and wraps transactIo
      if (/^\s*(?:async\s+)?function\s+transactIo|transactIo\s*[:=]/.test(fragment)) continue // a definition or an alias, not a write
      const declared = markersByWriter.get(rel) ?? []
      if (declared.some((marker) => fragment.startsWith(marker))) continue
      violations.push(`${rel}: transactIo( call site not declared in ${WRITE_INVENTORY_PATH} — a persisted write that no inventory row vouches for (N20 reverse)`)
    }
  }
}

// H-6 (v18): a source-tree `.mjs` copy is never legitimate — the runtime is
// TypeScript under `src/`; scripts live under `scripts/`. The 0.3.63
// install-layered.mjs duplicate (a 627-line byte-identical copy in a package
// src/) was invisible to every other guard; this one makes it fail loud.
{
  const srcMjs = []
  const scanSrc = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { scanSrc(path); continue }
      if (entry.isFile() && entry.name.endsWith('.mjs')) srcMjs.push(relative(root, path))
    }
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const src = join(root, entry.name, 'src')
    if (existsSync(src)) scanSrc(src)
  }
  if (srcMjs.length > 0) {
    violations.push(`source-tree .mjs file(s) (H-6: scripts belong under scripts/, not package src/): ${srcMjs.join(', ')}`)
  }
}

// N8 (v37 S2.1 / I-3): a published `./invariant` companion is unreachable — the
// platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis
// row, so the v37 batch removed all 29. Re-adding one means adding its row.
{
  const companionPackages = []
  let manifestsRead = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue
    const dir = join(root, entry.name)
    const manifestPath = join(dir, 'package.json')
    const hasManifest = existsSync(manifestPath)
    if (isInvariantCompanion(
      existsSync(join(dir, 'src', 'invariant.ts')),
      hasManifest && manifestPublishesInvariant(manifestPath, entry.name),
    )) {
      companionPackages.push(entry.name)
    }
    if (hasManifest) manifestsRead += 1
  }
  if (manifestsRead === 0) {
    violations.push(`no package manifest read under ${root} — the N8 companion scan cannot decide (a vacuum pass is not a pass)`)
  }
  if (companionPackages.length > 0) {
    violations.push(`published ./invariant companion(s) that no cordis row mounts (v37 S2.1): ${companionPackages.join(', ')} — the platform auto-assembles nothing; mount it with an explicit row or drop the companion`)
  }
}

// H2 (v11): a probed evolution service key without ANY provider is the
// P0-1 class (doctor's evolutionReview ghost) — fail the gate.
const orphanKeys = ghostServiceKeys(probedEvolutionKeys, providedEvolutionKeys)
  // N10b (S3.4/A99): the probe set has a SHIPPED home — core's PLATFORM_SERVICE_PROBES, the table
  // /evolution doctor judges capability absence from (O-2). Every probe in the tree must be
  // declared there and every declared entry must still be probed; without this cross-check a new
  // `ctx.get` would be invisible to the doctor section (the "6 of 26" gap, one release later).
  {
    const tablePath = join(root, CORE_SRC, 'platform-services.ts')
    if (!existsSync(tablePath)) {
      // NOT ARMED, never a violation: a tree without the shipped table is not the family tree
      // (the guard runs against fixture trees in its own sentry spec), exactly like N20 when the
      // write inventory is absent. The real tree carries both sides, and there the check bites.
      console.log(`verify-arch-guards: N10b not armed: no ${CORE_SRC}/platform-services.ts under ${root}`)
    } else {
      const declared = declaredServiceKeysIn(readFileSync(tablePath, 'utf8'))
      const declaredSet = new Set(declared)
      for (const key of [...probedServiceKeys].sort()) {
        if (!declaredSet.has(key)) violations.push(`${CORE_SRC}: ctx.get('${key}') is probed in the tree but not declared in platform-services.ts — declare it (service, feature, side) so capability absence stays reportable (rule N10b)`)
      }
      for (const key of declared) {
        if (!probedServiceKeys.has(key)) violations.push(`${CORE_SRC}/platform-services.ts: declares '${key}' but no source probes it — drop the entry (rule N10b)`)
      }
    }
  }
if (orphanKeys.length > 0) {
  violations.push(`ghost service key(s) probed but never provided: ${orphanKeys.join(', ')} (an evolution service key with zero providers makes a diagnosis silently lie)` )
}

// N24 (0.14): the client halves draw with tokens, not literals. The rule exists because the
// panel's stylesheet is a plain string in the bundle: no build step can typecheck it.
{
  let clientFilesScanned = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue
    const clientRoot = join(root, entry.name, 'src', 'client')
    if (!existsSync(clientRoot)) continue
    const walk = (dir) => {
      for (const child of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, child.name)
        if (child.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(child.name)) continue
        clientFilesScanned += 1
        const findings = clientStyleLiterals(readFileSync(full, 'utf8'))
        if (findings.length > 0) {
          violations.push(`literal type/colour in a client half (N24): ${relative(root, full)} — ${findings.slice(0, 4).join(' | ')} (use a --dsh-/--dsw- token or a calc() over one)`)
        }
      }
    }
    walk(clientRoot)
  }
  // No vacuum violation here on purpose: a tree may legitimately have no client half (the guard
  // specs scan synthetic fixtures), and the whole-tree vacuum check above already owns the
  // "did anything get scanned at all" class.
  void clientFilesScanned
}
// N25/N26/N27/E1/N29/N30 (0.15, 0.18): six more answers about the same client halves N24 walks. They
// are one block on purpose — the rule family is "a browser half can only use what the platform gives
// it", and splitting the walk six ways would scan the same files six times for one verdict each.
{
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue
    const clientRoot = join(root, entry.name, 'src', 'client')
    if (!existsSync(clientRoot)) continue
    const walk = (dir) => {
      for (const child of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, child.name)
        if (child.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(child.name)) continue
        const text = readFileSync(full, 'utf8')
        const file = relative(root, full)
        const scale = clientScaleLiterals(text)
        if (scale.length > 0) {
          violations.push(`client half draws a radius or a hairline it did not take from the scale (N25): ${file} — ${scale.slice(0, 4).join(' | ')} (use var(--evo-radius-*) / var(--evo-hairline-width))`)
        }
        const colour = interactionColourOffenders(text)
        if (colour.length > 0) {
          violations.push(`static rule borrows an interaction colour (N26): ${file} — ${colour.slice(0, 4).join(' | ')} (a state takes a layer or a label token)`)
        }
        const geometry = clientGeometryLiterals(text)
        if (geometry.length > 0) {
          violations.push(`client half writes geometry as a pixel literal (N27): ${file} — ${geometry.slice(0, 4).join(' | ')} (use var(--evo-space-*) / var(--evo-cap-*) / var(--evo-measure-read))`)
        }
        const host = clientHostOffenders(text)
        if (host.length > 0) {
          violations.push(`browser half reaches for the host runtime (N28/E1): ${file} — ${host.slice(0, 4).join(' | ')}`)
        }
        const fileKey = file.split('\\').join('/')
        // N29 is scoped to the client ENTRY (the apply body): a platform seat read there can land
        // before the plugin that provides it, while the same read inside a helper the entry calls
        // per event is a deliberate per-call read. Documented false negative: a capture inside a
        // helper the entry calls AT APPLY time.
        if (/(^|\/)src\/client\/index\.ts$/.test(fileKey)) {
          const captures = platformServiceCaptures(text)
          if (captures.length > 0) {
            violations.push(`client entry captures a platform service in a binding (N29): ${file} — ${captures.join(', ')} (read it through a callable probe: the settings shell that provides the seat may activate after this row)`)
          }
        }
        if (fileKey !== OBSERVABLE_OWNER) {
          const sources = handRolledSources(text)
          if (sources.length > 0) {
            violations.push(`client half hand-rolls an observable source (N30): ${file} — ${sources.slice(0, 3).join(' | ')} (one owner: ${OBSERVABLE_OWNER}; the renderer caches one hook binding per source object and compares the snapshot by reference)`)
          }
        }
      }
    }
    walk(clientRoot)
  }
}

if (checkedCount === 0) {
  // V4-30 (0.3.26): the guard must never pass on an unscanned tree (the F-103
  // vacant-guard class) — a wrong root or an empty overlay fails loud.
  const message = `verify-arch-guards: no .ts file(s) scanned under ${root} — check the packages root (a vacuum pass is not a pass)`
  if (strict) {
    // Exit codes are family-wide: 1 = the guard ran and the tree failed it,
    // 2 = the guard could not run (usage/missing root, see the guard-scripts
    // sentry). An empty-but-present root is the first case, like
    // verify-dependency-closure's V4-29 vacuum.
    console.error(`verify-arch-guards [strict]: ${message}`)
    process.exit(1)
  }
  console.warn(`verify-arch-guards [warn]: ${message}`)
}

if (violations.length > 0) {
  const summary = `${violations.length} architecture guard violation(s)`
  if (strict) {
    console.error(`verify-arch-guards [strict]: ${summary}:`)
    console.error(violations.join('\n'))
    console.error('verify-arch-guards: these are the G3/G4 convergence TODO list — do not add new copies; single-source the symbol instead.')
    process.exit(1)
  }
  console.warn(`verify-arch-guards [warn]: ${summary} (convergence TODO — G3.2/G4.8):`)
  console.warn(violations.join('\n'))
} else {
  if (PLATFORM_CITE_BASELINE.size > 0) console.log(`verify-arch-guards: N35 debt — ${[...PLATFORM_CITE_BASELINE.values()].reduce((sum, n) => sum + n, 0)} frozen platform line-cite(s) in ${PLATFORM_CITE_BASELINE.size} file(s); convert them to symbol citations as those files are touched (expires: group 6, the documentation pass)`)
if (SWALLOWED_READ_BASELINE.size > 0) console.log(`verify-arch-guards: N36 debt — ${[...SWALLOWED_READ_BASELINE.values()].reduce((sum, n) => sum + n, 0)} reviewed read-swallow(s) in ${SWALLOWED_READ_BASELINE.size} file(s); migrate them to the three-state probe as those files are touched (the class is scheduled for the group-5 three-state sweep)`)
if (GUARD_VACUITY.length > 0) console.log(`verify-arch-guards: ${GUARD_VACUITY.length} registered guard-vacuity debt(s) — ${GUARD_VACUITY.map(entry => `${entry.guard} (empty input: ${entry.emptyInput.split(':')[0]}; expires ${entry.expiry})`).join('; ')}`)
const uncovered = RULES.filter(entry => entry.sample !== 'detector').map(entry => entry.id)
if (uncovered.length > 0) {
  console.error(`verify-arch-guards: ${uncovered.length} rule(s) still owe a detector sample: [${uncovered.join(', ')}] — a rule whose detector is never proven is worse than no rule`)
  process.exit(1)
}
console.log(`verify-arch-guards: OK — ${RULES.length} rule(s) clean (--list-rules prints the registry): no DSH_HOME reads outside ${CORE_SRC} (N1), single-source contracts intact (N2), all numeric fields clamped (N3), no ghost evolution* service keys (H2), no ApprovalPolicyLike/effectiveSessionPolicy copies outside ${APPROVAL_SRC} (N2), kernel imports only L0 seams (N5), composition bundles carry no runtime code (N6), every SkillLibrary built through core's helper (N7 — ${SKILL_LIBRARY_TODO.size} exception(s)), no published ./invariant companion (N8), no literal type/colour in the client halves (N24), format-control classes single-sourced (N9), no undocumented platform service probe (N10), ONE reader for the platform dispatch vocabulary (N11), every module-scope mutable store registered (N12 — ${MUTABLE_STATE.size} entries), no must-execute payload on the non-waking primitive outside the register (N13a — ${INJECT_SITES.size} debts), no wake primitive read into a local (N13b), every durable-read-failure swallow registered (N14 — ${SWALLOW_CATCH.size} entries), every family Markdown code anchor resolves (N15), every platform registry read asks in the calling scope (N16 — ${SCOPE_READ_REGISTER.size} registered global read(s)), every dispatch-modality branch registered (N17 — ${MODALITY_BRANCH_REGISTER.size} branch(es)), every session/event consumer consults the opt-in gate (N18 — ${SESSION_GATE_REGISTER.size} exception(s)), every declared persisted write site matches its writer's serialization (N20 — ${writeInventoryCount} site(s)), every client entry reads its platform seats through a callable probe (N29) and builds its observable source in the one owner module (N30), ${docFactSummary})`)
}
// P3-2 (v14): the N4 "dead-fallback return" listing was REMOVED. Its heuristic
// matched `?? ''` / `?? <id>Id` textually with no type information, so all 78
// reported lines were idiomatic `noUncheckedIndexedAccess`/optional-field
// guards (`regex[1] ?? ''`, `lines[i] ?? ''`, `config.root ?? ''`) — a signal
// with zero true positives that printed on every run and trained reviewers to
// ignore the section. A type-aware equivalent belongs to oxlint, not here.
