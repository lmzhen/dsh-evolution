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
 *       the baseline map; files already mentioning the platform pass).
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
 *   N15. a family Markdown anchor (`evolution-core/src/x.ts:42`) must resolve:
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
 * H2 (0.3.58) heuristic boundary (N18, v12): the ghost-service-key probe is
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
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? 'packages/evolution'
// R-03: a missing root used to surface as a raw ENOENT from readdirSync —
// report the usage line instead (same posture as verify-dependency-closure).
if (!existsSync(root)) {
  console.error(`usage: verify-arch-guards.mjs <packages/evolution-root> [--strict] (root not found: ${root})`)
  process.exit(2)
}
const strict = process.argv.includes('--strict') || process.env.DSH_EVOLUTION_ARCH_STRICT === '1'
const CORE_SRC = 'evolution-core/src'
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
// N12 (P5): module-scope mutable process state. Key = '<file> :: <binding>'.
const MUTABLE_STATE_RE = /^const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+(?:Set|Map|WeakMap)\b/gm
const MUTABLE_STATE = new Map([
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
const SWALLOW_CATCH = new Map([
  ['evolution-commands/src/index.ts :: try {return statSync(path).mtimeMs} catch -> absent', 'optional mtime probe: the curator treats a null mtime as never-the-latest AND warns once (probeWarned), so an unreadable stat is not a silent clean verdict; migrate to the Probe union when the adapter is typed.'],
  ['evolution-core/src/skill-store.ts :: try {entries = await this.io.list(dir)} catch -> absent', 'KNOWN GAP (listSupportFiles): the docstring itself conflates "unreadable" with "no support files"; fix = Probe<string[]>, not a register entry.'],
  ['evolution-core/src/skill-store.ts :: try {entries = await this.io.list(backupRoot)} catch -> absent', 'KNOWN GAP (listSnapshots): an unreadable .backups reads as "no snapshots"; same Probe migration.'],
  ["evolution-curator/src/index.ts :: try {names = (await this.io.list(reportsRoot)).filter(name => name.startsWith('curator-') && name.endsWit} catch -> absent", 'P2-4 (v38) accepted posture: answers null but logs a warn separating a READ failure from "no reports"; stays listed until the Probe union lands.'],
])
/** Rule registry (append-only; --list-rules prints it and the docblock must match). */
const RULES = [
  { id: 'N1', title: 'DSH_HOME single source (evolution-core/src only)' },
  { id: 'N2', title: 'ApprovalPolicyLike / effectiveSessionPolicy single-sourced in evolution-approval' },
  { id: 'N3', title: 'Config numeric fields carry a value clamp' },
  { id: 'H2', title: 'no ghost evolution* service key (probe without provider)' },
  { id: 'N5', title: 'evolution-core imports only the L0 seams' },
  { id: 'N6', title: 'composition bundles carry no runtime code' },
  { id: 'N7', title: 'new SkillLibrary() only through core\'s helper' },
  { id: 'N8', title: 'no unpublished ./invariant companion' },
  { id: 'N9', title: 'format-control classes built from FORMAT_CONTROL_CLASS' },
  { id: 'N10', title: 'new platform-service probe carries a declaration anchor' },
  { id: 'N11', title: 'ONE reader for the platform dispatch vocabulary' },
  { id: 'N12', title: 'module-scope mutable process state is registered' },
  { id: 'N13a', title: 'must-execute payload not on the non-waking primitive' },
  { id: 'N13b', title: 'wake primitive called on its receiver' },
  { id: 'N14', title: 'durable-read failure not served as absent' },
  { id: 'N15', title: 'family Markdown code anchors resolve' },
  { id: 'N16', title: 'platform registry read asks in the calling scope' },
]

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
const probedEvolutionKeys = new Set()
const providedEvolutionKeys = new Set()
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

/** N15: family-anchored `path:line` citations in Markdown. The parser is pure
 * (self-tested at startup); resolution is the filesystem half. */
const FAMILY_ANCHOR_RE = /([A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:ts|mjs|cjs|json|ya?ml))[:：](\d+)(?:[-–,，](\d+))?/g

function staleAnchor(anchor, lineCount) {
  return anchor.line > lineCount
}

function docAnchorViolations(dir, packageDirs) {
  const out = []
  const seen = new Set()
  const visit = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) visit(path)
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      const rel = relative(root, path).split('\\').join('/')
      for (const match of readFileSync(path, 'utf8').matchAll(FAMILY_ANCHOR_RE)) {
        const segments = match[1].split('/').filter(Boolean)
        const at = segments.findIndex(segment => packageDirs.has(segment))
        if (at < 0) continue
        const tail = segments.slice(at).join('/')
        // `<pkg>/<file>` is the single-src shorthand for `<pkg>/src/<file>`.
        let target = join(root, tail)
        if (!existsSync(target) && segments.length - at === 2) target = join(root, segments[at], 'src', segments[at + 1])
        const anchor = { raw: match[0], line: Number(match[3] ?? match[2]) }
        const key = rel + ' :: ' + anchor.raw + ' :: ' + anchor.line
        if (seen.has(key)) continue
        seen.add(key)
        if (!existsSync(target)) {
          out.push(`${rel}: anchor "${anchor.raw}" names no family file (looked for ${tail})`)
          continue
        }
        const lineCount = readFileSync(target, 'utf8').split('\n').length
        if (staleAnchor(anchor, lineCount)) {
          out.push(`${rel}: anchor "${anchor.raw}" cites line ${anchor.line} of a ${lineCount}-line ${tail} — re-anchor it to the code`)
        }
      }
    }
  }
  visit(dir)
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
      // H2 (v11): collect probe/provider pairs for the ghost-key check.
      for (const match of text.matchAll(PROBE_RE)) probedEvolutionKeys.add(match[1])
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
        // Split on CRLF so `\r` is not left on the line end — otherwise the
        // comment strip below (`/\/\/.*$/`) cannot match a `//` comment on a
        // CRLF source file, and prose mentioning `z.number()` would be flagged.
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i += 1) {
          const code = (lines[i] ?? '').replace(/\/\/.*$/, '').trim()
          if (!/z\.number\(\)/.test(code)) continue
          if (/\.(?:min|max|finite|nonnegative)\(/.test(code)) continue
          violations.push(`${rel}:${i + 1}: numeric field without a value clamp (route through clampedNumber + a .min/.max schema bound)`)
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
        const rest = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '')
          .replace(/import\s+(?:type\s+)?[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
          .replace(/export\s+(?:type\s+)?[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
          .replace(/export\s*\{\s*\};?/g, '')
          .trim()
        if (rest !== '') {
          violations.push(`${rel}: composition bundle carries runtime code (bundles own YAML rows only)`)
        }
      }
      // N7 (v39, S3.1): SkillLibrary construction site.
      if (rel.includes('/src/') && SKILL_LIBRARY_RE.test(text) && !rel.startsWith(`${CORE_SRC}/`) && !SKILL_LIBRARY_TODO.has(rel)) {
        violations.push(`${rel}: new SkillLibrary(...) outside core's newSkillLibrary() helper (root/limits parsing is single-sourced) — build it with newSkillLibrary({ config, io, limits?, ctx?, threatExemptLabels? })`)
      }
      // N10 (v39, S3.4 rule ④): new platform service probe — see docblock.
      {
        const sites = (text.match(PLATFORM_GET_RE) ?? []).length
        const base = PLATFORM_GET_BASELINE.get(rel) ?? 0
        if (rel.includes('/src/') && sites > base && !/platform/i.test(text)) {
          violations.push(`${rel}: ${sites - base} new ctx.get('<platform service>') probe(s) with no platform-declaration anchor in the file (cite the platform declaration; baseline lives in PLATFORM_GET_BASELINE)`)
        }
      }
      // N11 (v37 P7a): ONE reader for the platform dispatch vocabulary — see
      // the docblock entry. Literals inside comments and string values are
      // inert, so the raw text is stripped first; a match therefore means the
      // file really compares or passes a dispatch event type.
      if (rel !== DISPATCH_GUARD_MODULE && !DISPATCH_GUARD_TEST_SUFFIXES.some(suffix => rel.endsWith(suffix))) {
        const code = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '')
          // Keep only string literals short enough to BE an event type; longer
          // ones are prose (prompt text, messages) that can mention a type
          // without matching on it.
          .replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, match => match.length <= 40 ? match : '""')
        const sites = (code.match(DISPATCH_EVENT_TYPE_RE) ?? []).length
        if (sites > 0) {
          violations.push(`${rel}: ${sites} platform dispatch event-type match(es) outside ${DISPATCH_GUARD_MODULE} (one vocabulary per dispatch mode; match ToolDispatchSignal.kind instead)`)
        }
      }
      // N12 (P5): module-scope mutable process state must be registered.
      // Known blind spot (documented; upgrade path = AST): state declared inside
      // a plugin's `apply()` body is invisible to a line rule — the family's
      // largest cluster (evolution-review's seven turn maps plus reviewInFlight
      // / skipNextCadenceFire / deferredFallbackReviews) lives there.
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
  for (const rule of RULES) console.log(`${rule.id}: ${rule.title}`)
  process.exit(0)
}
{
  const selfText = readFileSync(new URL(import.meta.url), 'utf8')
  const documented = new Set([...selfText.matchAll(/^ \*   (N\d+[a-z]?|H2)\./gm)].map(match => match[1]))
  const undocumented = RULES.filter(rule => !documented.has(rule.id)).map(rule => rule.id)
  const unregistered = [...documented].filter(id => !RULES.some(rule => rule.id === id))
  if (undocumented.length > 0 || unregistered.length > 0) {
    console.error(`verify-arch-guards: rule inventory mismatch — undocumented: [${undocumented.join(', ')}], unregistered: [${unregistered.join(', ')}] (the docblock and RULES must list the same ids)`)
    process.exit(1)
  }
  const detectors = [
    ['N16', () => scopeLessReadKeys("const r = ctx.get('tools')\nr.get(name)").length === 1
      && scopeLessReadKeys("const r = ctx.get('tools')\nr.get(name, scope)").length === 0
      && scopeLessReadKeys("const c = ctx.get('skills')\nc.list({ scope })").length === 0
      && scopeLessReadKeys("const c = ctx.get('skills')\nc.list()").length === 1],
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
    if (existsSync(join(dir, 'src', 'invariant.ts'))
      || (hasManifest && manifestPublishesInvariant(manifestPath, entry.name))) {
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
const orphanKeys = [...probedEvolutionKeys].filter(key => !providedEvolutionKeys.has(key))
if (orphanKeys.length > 0) {
  violations.push(`ghost service key(s) probed but never provided: ${orphanKeys.join(', ')} (an evolution service key with zero providers makes a diagnosis silently lie)` )
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
  console.log(`verify-arch-guards: OK — ${RULES.length} rule(s) clean (--list-rules prints the registry): no DSH_HOME reads outside ${CORE_SRC} (N1), single-source contracts intact (N2), all numeric fields clamped (N3), no ghost evolution* service keys (H2), no ApprovalPolicyLike/effectiveSessionPolicy copies outside ${APPROVAL_SRC} (N2), kernel imports only L0 seams (N5), composition bundles carry no runtime code (N6), every SkillLibrary built through core's helper (N7 — ${SKILL_LIBRARY_TODO.size} exception(s)), no published ./invariant companion (N8), format-control classes single-sourced (N9), no undocumented platform service probe (N10), ONE reader for the platform dispatch vocabulary (N11), every module-scope mutable store registered (N12 — ${MUTABLE_STATE.size} entries), no must-execute payload on the non-waking primitive outside the register (N13a — ${INJECT_SITES.size} debts), no wake primitive read into a local (N13b), every durable-read-failure swallow registered (N14 — ${SWALLOW_CATCH.size} entries), every family Markdown code anchor resolves (N15), every platform registry read asks in the calling scope (N16 — ${SCOPE_READ_REGISTER.size} registered global read(s))`)
}
// P3-2 (v14): the N4 "dead-fallback return" listing was REMOVED. Its heuristic
// matched `?? ''` / `?? <id>Id` textually with no type information, so all 78
// reported lines were idiomatic `noUncheckedIndexedAccess`/optional-field
// guards (`regex[1] ?? ''`, `lines[i] ?? ''`, `config.root ?? ''`) — a signal
// with zero true positives that printed on every run and trained reviewers to
// ignore the section. A type-aware equivalent belongs to oxlint, not here.
