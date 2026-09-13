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
 *   N5. `evolution-core` is the kernel: it must not import any other family
 *       package except the L0 seams (state-storage, memory). Dependency
 *       closure owns the full graph; this is the reverse-direction tripwire.
 *   N6. composition bundles (host/all/preset/agent) carry no runtime code —
 *       their substance is the manifest's YAML rows, so every src module
 *       must reduce to imports / re-exports / `export {}`.
 *   N7. `new SkillLibrary(...)` must route through core's newSkillLibrary()
 *       helper so root/limits parsing stays single-sourced (S3.1). The
 *       pre-v39 sites are listed in SKILL_LIBRARY_TODO — shrink that list as
 *       the convergence lands, the rule then bites new drift.
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
// N7 (v39, S3.1): pre-convergence construction sites, by file.
const SKILL_LIBRARY_RE = /\bnew SkillLibrary\(/
const SKILL_LIBRARY_TODO = new Set([
  'evolution-curator/src/index.ts',
  'evolution-commands/src/index.ts',
  'evolution-learning-graph/src/index.ts',
  'evolution-maintenance/src/tools.ts',
  'evolution-skill-catalog/src/index.ts',
  'evolution-review/src/index.ts',
  'tool-skill-manage/src/index.ts',
])
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
        violations.push(`${rel}: new SkillLibrary(...) outside core's newSkillLibrary() helper (root/limits parsing is single-sourced)`)
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

walk(root)

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
  console.log(`verify-arch-guards: OK — no DSH_HOME reads outside ${CORE_SRC} (N1), single-source contracts intact (N2), all numeric fields clamped (N3), no ghost evolution* service keys (H2), no ApprovalPolicyLike/effectiveSessionPolicy copies outside ${APPROVAL_SRC}, kernel imports only L0 seams (N5), composition bundles carry no runtime code (N6), no new SkillLibrary construction sites (N7 — 7 pre-v39 files still on the S3.1 TODO list), no published ./invariant companion (N8), format-control classes single-sourced (N9), no undocumented platform service probe (N10), ONE reader for the platform dispatch vocabulary (N11)`)
}
// P3-2 (v14): the N4 "dead-fallback return" listing was REMOVED. Its heuristic
// matched `?? ''` / `?? <id>Id` textually with no type information, so all 78
// reported lines were idiomatic `noUncheckedIndexedAccess`/optional-field
// guards (`regex[1] ?? ''`, `lines[i] ?? ''`, `config.root ?? ''`) — a signal
// with zero true positives that printed on every run and trained reviewers to
// ignore the section. A type-aware equivalent belongs to oxlint, not here.
