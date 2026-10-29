/**
 * Skill library management for the self-evolution plugin.
 *
 * Skills live under `$DSH_HOME/skills` (`~/.dsh/skills` by default), matching
 * the default dsh skill-filesystem user root. The plugin only manages skills
 * it created unless a `.hermes-managed` marker opts a skill in. Archival is a
 * move to `.archive/` — never a hard delete.
 *
 * ## Concurrency discipline (OPT-09, 2026-09) — read before adding a mutator
 *
 * Three primitives, three distinct jobs (they compose, they do not replace
 * each other):
 *
 * 1. **In-process serial queue** (`this.serial`, makeSerialQueue) — orders the
 *    read→plan→commit phases of one skill's mutation against OTHER mutators
 *    in this process. Used by: create/update/patch/setPinned/restructure/
 *    writeSupportFile/removeSupportFile and (whole-mutation) consolidate.
 *    NON-reentrant: a callback must never call a public method that wraps
 *    itself in `this.serial` (archive/restoreFromArchive deliberately do not).
 * 2. **Per-directory write lock** (io.ts LOCK_*) — cross-process mutual
 *    exclusion plus in-process crash ownership (tickets, takeover). Checked
 *    with `supportDirsUnlistable` before any destructive move (archive/restore/
 *    snapshot); held inside transactIo by byte writers.
 * 3. **CAS baseline (`expected:`)** — any read whose bytes feed a later write
 *    must either live inside the serial section that commits the write, or
 *    carry its plan-time bytes as `expected` so the commit fails closed on
 *    drift (V8-11 / V24-01). A read outside the serial section WITHOUT a
 *    baseline is a lost-update bug; this file's history is the test suite.
 *
 * Known residuals (deliberate, documented at their sites): the archive commit
 * re-check narrows but does not close the pin race (OPT-06); snapshotAll
 * re-probes after its copies so a mid-copy writer demotes to `skipped`
 * (OPT-07); the movers' probe→rename window is owned by the io.ts protocol.
 */

import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { authorityFrom, type WriteAuthority } from './write-authority.ts'
import { resolveCitations } from './citations.ts'
import { scanContentThreats, type ScanOptions } from './threats.ts'
import { isReviewChannelSession } from './review-channel.ts'
import { isCommittedWarning, nodeEvolutionIo, transactIo, type EvolutionIoLike } from './io.ts'
import { appendEvolutionEvent, eventsFile } from './evolution-events.ts'
import { isAbsent, isPresent, isUnknown, probeAbsent, probeList, probeMtime, probePresent, probeReason, probeText, probeUnknown, type Probe } from './probe.ts'
import { evolutionRoot } from './state-store.ts'
import { DEFAULT_ARCHIVE_RETENTION_POLICY, DEFAULT_CITATION_POLICY, DEFAULT_REFERENCE_REWRITE_POLICY, DEFAULT_SKILL_LIMITS, DEFAULT_SUPPORT_FILE_CHAR_POLICY } from './limits.ts'
import type { SkillLimits } from './limits.ts'
import { applyReferenceRewrite, describeReferenceRewrite, planReferenceRewrite, planRehoming } from './reference-rewrite.ts'
import { exceedsContentLimit, frontmatterBlock, normalizeFrontmatter, parseFrontmatter, shrinksOverLimit, validateFrontmatter } from './frontmatter.ts'
import { FUZZY_MAX_PATTERN_CHARS, FUZZY_MAX_WORK, trimPatternBoundaries, fuzzyPatch } from './fuzzy-match.ts'
import { makeSerialQueue } from './serial.ts'
import { supportRefs } from './support-refs.ts'
import { selectSections } from './section-selection.ts'
import { MutationUnit, fileMutationLock, type MutationResult, type MutationUnitHooks } from './mutation-unit.ts'
import { SkillModel } from './skill-model.ts'
import { unitJournalPort, unitSnapshotPort } from './mutation-storage-adapter.ts'
import { projectExtractBodies, type ExtractPlanDraft } from './extract-plan.ts'
import { diffFindings } from './skill-lint.ts'
import { contentHash, loadMutations, recordMutation, type MutationRecord } from './mutations.ts'
import { revisionFingerprint, revisionSupportDigest, type RevisionAnchor, type RevisionFile } from './skill-revision.ts'
import { type UnitHead, contentRetentionFeedback, HISTORY_DIR, loadVersionContent, loadVersions, recordVersions, type RecordedVersions, type SkillVersion } from './skill-history.ts'
import { getRecord, mutateUsage, suppressedFile, usageFile } from './usage.ts'
import { assessStructureHealth, DEFAULT_HEALTH_THRESHOLDS, lintBody, type SkillHealthAssessment, type SkillHealthThresholds } from './skill-health.ts'
import { CONTENT_SPLIT_HINT, DEFAULT_SKILL_VERSION_KEEP, PROTECTED_BUILTIN_SKILLS, SKILL_NAME_RE, SUPPORT_DIRS } from './constants.ts'

/**
 * The CLASS boundary default authority (G1/1.1, Stage 2).
 *
 * The FACTORY (newSkillLibrary) requires an explicit authority and the v35 A6 register pins every
 * production construction, so a production caller cannot omit one. The class is the INTERNAL
 * boundary: arch rule N7 forbids constructing it directly in production, while ~200 test fixtures do
 * exactly that and ARE the operator, so an omitted authority reads as foreground here - named and
 * stated instead of silent.
 */
const CLASS_DEFAULT_AUTHORITY: WriteAuthority = authorityFrom({ origin: 'foreground' })

/** 0.3.16 (S1.13, T-6): the pointer-line prefix written into a body when a
 * section is moved to references/ — single literal, both restructure and
 * append-mode consolidation emit the same discoverability line. */
const POINTER_LINE_PREFIX = '> 详见 references/'

/** V3: the pure LINK LIST that travels with a pointer line. A moved section's
 * citations move one hop deeper, so without this line the body stops mentioning
 * those files at all and `pointer_missing` (body-level by design) reports them as
 * unpointed — measured on the live skill, moving 验证手法 took `missing` from 0 to
 * 8 until the list was emitted. Design §2.3 explicitly allows link-list lines in
 * the body, and a list of paths carries no content claim. */
const POINTER_REFS_PREFIX = '> 本节引用：'
/** Cap keeps the line readable; an ellipsis marks a truncated list (visible, never
 * silently short). */
const POINTER_REFS_CAP = 12

/**
 * The body lines one moved section collapses to: the pointer plus the link list of
 * the support files it cited (excluding the file it moved into).
 * @param rel - the support path the section moved into.
 * @param sectionText - the moved section's text.
 * @returns one or two body lines.
 */
function pointerBlock(rel: string, sectionText: string): string[] {
  const cited = [...new Set(resolveCitations({ content: sectionText, file: 'SKILL.md', files: [] })
    .refs.filter(ref => ref.kind === 'citation' && ref.target !== null)
    .map(ref => ref.target as string))]
    .filter(target => target !== rel)
    .sort()
  const lines = [`${POINTER_LINE_PREFIX}${rel.split('/').at(-1)}`]
  if (cited.length > 0) {
    const shown = cited.slice(0, POINTER_REFS_CAP)
    lines.push(`${POINTER_REFS_PREFIX}${shown.join(' · ')}${cited.length > shown.length ? ' …' : ''}`)
  }
  return lines
}

/** Collision tail for the refusal plan note (empty when nothing collided). */
function collisionsNote(collisions: readonly string[]): string {
  return collisions.length === 0 ? '' : ` collisions: ${collisions.slice(0, 5).join(', ')}`
}
import type { EvolutionSkillMutatedEvent } from './events.ts'

// G3a: process-local sequence so two tree changes in one millisecond still get distinct unit ids.
let nextUnitSeq = 0

export interface SkillSummary {
  name: string
  description: string
  path: string
  protectedBy: string | null
  /** A1-17 (v18): the marker probe itself failed (EACCES/EIO), so "no marker"
   * cannot be told apart from "directory unreadable". Consumers must treat this
   * as protected, never as unprotected.
   * v41: this flag and `protectedBy` ARE the read three-state —
   * (null, false) = no marker, (X, false) = present, (_, true) = unreadable.
   * Read them together, never this flag alone; it is a published field, so the
   * encoding stays (core's `Probe<T>` is for internal decisions, not for this
   * contract). */
  protectionUnknown: boolean
  managed: boolean
  /** E-11 (v18): the frontmatter `whenToUse` routing hint, published so the
   * platform catalog keeps it while this provider shadows the upstream
   * filesystem provider. Absent when the frontmatter has none. */
  whenToUse?: string
  /** v35 C11: the whole SKILL.md body, present only for
   * {@link SkillLibrary.list} calls that pass `{ withContent: true }`. A consumer
   * that needs both the summary fields and the body (tree hashing, enrichment,
   * drift scans) saves the second per-skill read; the default stays body-free so
   * the common listing does not hold a whole tree in memory. */
  content?: string
  /** T2-07/A22: the parsed frontmatter record, present only for
   * {@link SkillLibrary.list} calls that pass `{ withFrontmatter: true }`. The
   * listing parses the file it already read, so a consumer that derives a policy
   * from frontmatter (the catalog’s invocation map) shares that ONE read instead
   * of paying a second per-skill read. Absent when the file carries no parseable
   * frontmatter — the same posture as its description. */
  frontmatter?: Record<string, unknown>
}

/**
 * Stage-time anchor for a full-content write (v35 C9): the sha256 the caller read
 * when it staged the plan, or `absent` when the target did not exist then. The
 * library compares it against the bytes it reads INSIDE the write's own lock — the
 * same read the write commits — so a concurrent writer landing between staging and
 * commit is refused instead of silently overwritten.
 */
export type WriteAnchor = { readonly sha256: string } | { readonly absent: true }

/**
 * What the write lock observed about an anchor target.
 * - `match`: the anchor holds; the write proceeds.
 * - `drift`: the target exists with different bytes.
 * - `missing`: the target does not exist (an `absent` anchor `match`es this).
 */
export type AnchorVerdict = 'match' | 'drift' | 'missing'

/**
 * Evaluate a stage-time anchor against the bytes a locked read observed.
 * @param anchor - the caller's anchor, or `undefined` for an unanchored write.
 * @param current - the bytes the write lock read (`null` = the target is absent).
 * @returns `match` when the write may proceed, otherwise the refusal verdict.
 */
export function anchorVerdict(anchor: WriteAnchor | undefined, current: string | null): AnchorVerdict {
  if (anchor === undefined) return 'match'
  if ('absent' in anchor) return current === null ? 'match' : 'drift'
  if (current === null) return 'missing'
  return contentHash(current) === anchor.sha256 ? 'match' : 'drift'
}

/**
 * Build the refusal for a skill write whose anchor did not hold. The wording is
 * the library's own; a caller with staged-replay wording (the skill tool, the
 * review plan) re-words it from {@link SkillActionResult.anchor}.
 * @param name - the skill name the refusal names.
 * @param verdict - the non-matching verdict.
 * @returns the refusal result (nothing was written).
 */
function anchorRefusal(name: string, verdict: Exclude<AnchorVerdict, 'match'>): SkillActionResult {
  return {
    ok: false,
    stale: true,
    anchor: verdict,
    message: verdict === 'missing'
      ? `技能「${name}」不存在。`
      : `技能 "${name}" 在读取之后被改动过；为避免覆盖更新的内容，本次写入被拒绝。`,
  }
}

/**
 * Build the refusal for a support-file write/remove whose anchor did not hold.
 * @param name - the owning skill name.
 * @param filePath - the support-file path inside the skill.
 * @param verdict - the non-matching verdict.
 * @returns the refusal result (nothing was written or removed).
 */
/**
 * Refusal for a target the locked read could not verify at all (EISDIR, an
 * unreadable file). A staged replay reports "could not be verified" instead of
 * propagating an exception: nothing was read, so nothing can have been written.
 * @param name - the owning skill name.
 * @param filePath - the support-file path, or `null` for the skill body.
 * @returns the refusal result.
 */
function anchorUnverifiable(name: string, filePath: string | null): SkillActionResult {
  return {
    ok: false,
    stale: true,
    anchor: 'drift',
    message: filePath === null
      ? `无法读取技能 "${name}" 以校验暂存内容。`
      : `无法读取技能 "${name}" 的支撑文件 "${filePath}" 以校验暂存内容。`,
  }
}

function anchorRefusalFile(name: string, filePath: string, verdict: Exclude<AnchorVerdict, 'match'>): SkillActionResult {
  return {
    ok: false,
    stale: true,
    anchor: verdict,
    message: verdict === 'missing'
      ? `文件「${filePath}」不在技能「${name}」里。`
      : `技能 "${name}" 的支撑文件 "${filePath}" 在读取之后被改动过；为避免覆盖更新的内容，本次写入被拒绝。`,
  }
}

/**
 * v43 S2-14 (FLOW2-1/flow-3): the target could not be READ at all — EISDIR, an
 * unreadable file, a failing backend. `io.readText` returns null only for a
 * genuinely missing path and throws for everything else, so a raw errno used to
 * escape `update` / `patch` / `write_file` to the model while the remove path had
 * classified the same condition since A-5 (v15). Structured refusal, nothing
 * written.
 *
 * @param label - `name` or `name/filePath`, as the caller's surface names it.
 * @param error - the read failure.
 * @returns the refusal result.
 */
function unreadableTarget(label: string, error: unknown): SkillActionResult {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
    ?? (typeof error === 'string' && error.startsWith('EISDIR') ? 'EISDIR' : undefined)
  const detail = code === 'EISDIR'
    ? 'the path is a DIRECTORY, not a file'
    : error instanceof Error ? error.message : String(error)
  return { ok: false, message: `读不出「${label}」：${detail}。没有写入任何内容。` }
}

export interface SkillActionResult {
  ok: boolean
  message: string
  path?: string
  /** Frontmatter keys auto-quoted for catalog-loadable YAML (0.3.11) — set
   * only when the write path modified the block. */
  normalizedFrontmatterFields?: string[]
  /** 0.3.18 (E-68): patch produced byte-identical content (old===new) — no
   * write, no audit, no mutation event; callers must not count a patch. */
  noop?: boolean
  /** Set when the caller passed a {@link WriteAnchor} that the locked read did
   * not satisfy: nothing was written. Carries {@link SkillActionResult.anchor}
   * so a caller with staged-replay wording can translate it (v35 C9). */
  stale?: true
  /** The locked read's verdict for the caller's anchor. */
  anchor?: AnchorVerdict
}

/**
 * One section move of a restructure proposal (008 batch B): a body section
 * anchored by its exact `## heading` line is moved to a references/ support
 * file and replaced by a pointer line. The skill name/dir never change —
 * restructure is a content-distribution repair, not a routing change.
 */
export interface SkillRestructureMove {
  /** The `##` heading title, matched as an exact line (leading `##` + spaces); no fuzzy matching. */
  heading: string
  /** Destination support file: `references/<topic>.md` (references/ only — moved content is log/detail, never a template or script). */
  toFile: string
}

/** Upper bound of moves per restructure proposal (validator and core agree). */
export const MAX_RESTRUCTURE_MOVES = 5

/** Restructure targets are plain markdown files under references/ — no
 * subdirectories, no other support kind. V8-10 (0.3.47): the regex-level
 * `(?!.*\.\.)` keeps the restructure-created set EXACTLY the set
 * validateSupportPath can reopen — a `references/my..notes.md` target (double
 * dots) used to pass here while every later patch/write/remove on it was
 * refused as traversal (an orphan file the user could not touch). */
export const RESTRUCTURE_TARGET_RE = /^references\/[a-z0-9](?!.*\.\.)[a-z0-9._-]*\.md$/

/** F-20 (v18): the character rule shared by support-file names and snapshot
 * `extras/` entry names. The two exported names used to carry the same literal
 * independently; both now derive from this one. */
const SUPPORT_ENTRY_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/

/** Extra file name carried inside a snapshot's `extras/` directory. */
export const SNAPSHOT_EXTRA_NAME_RE = SUPPORT_ENTRY_NAME_RE

/** An opaque side file stored under a snapshot's `extras/` (curator state etc.). */
export interface SnapshotExtra {
  name: string
  content: string
}

/** Normalized manifest of a skills snapshot. */
export interface SnapshotManifest {
  reason: string
  createdAt: string
  /** Active skill names at snapshot time. */
  skills: string[]
  /** V25-05 (v25): skills that were SKIPPED by the write-lock probe at
   * snapshot time (a live byte-writer held them) — they are NOT in the
   * snapshot directory and are NOT restored by a whole-tree restore, which
   * clears the live tree and copies back only `skills`. Consumers must
   * surface this list; restore reports it in its result message. Absent
   * (empty) on pre-0.3.67 manifests. */
  skipped: string[]
  /** Co-copied sidecar file names (usage/suppression). */
  sidecars: string[]
  /** Whether `.archive/` was co-copied; absent on legacy manifests (do not touch archive on restore). */
  hasArchive?: boolean
  /** Extras declared under `extras/`; only these names are ever read back. */
  extras: string[]
}

/** Who is writing: a foreground user-directed tool call, or the autonomous review/curator pipeline. */
export type WriteOrigin = 'foreground' | 'subagent' | 'background_review'

/** Options for `SkillLibrary.archive`. The absorbed-into name and the archival reason are distinct fields. */
export interface ArchiveOptions {
  /** Umbrella skill this one was consolidated into; when set it must exist (consolidate semantics). */
  absorbedInto?: string
  /** Human-readable reason written to `.archive-reason`; default derives from `absorbedInto`. */
  reason?: string
  /** Permit archiving a bundled skill (curator prune-builtins only; hub-installed and pinned stay protected). */
  allowBundled?: boolean
  /** Unit shared with the rest of a multi-skill transaction (merge). */
  unitId?: string
  /** Cross-skill landmark for the unit; a merge source names the target. */
  unitHead?: UnitHead
}

/** One multi-skill merge commit: target body + support files, with the source names it absorbs. */
export interface CommitMergePlan {
  readonly runId?: string
  /** The unit transaction id; history must record this exact id for undo. */
  readonly unitId?: string
  readonly target: string
  /** Whether the target already exists. The caller planned this; commit re-checks it. */
  readonly targetExists: boolean
  readonly sources: readonly string[]
  readonly body: string
  readonly supportFiles: readonly { readonly path: string; readonly content: string }[]
  /** Plan-time target body; null for a create. */
  readonly expectedTargetBody: string | null
  readonly expectedSourceBodies: readonly { readonly name: string; readonly body: string }[]
  /** Stage limits snapshot; absent uses the deployed store limits. */
  readonly limits?: import('./limits.ts').SkillLimits
  readonly targetRevision?: RevisionAnchor
  readonly sourceRevisions?: Readonly<Record<string, RevisionAnchor>>
  readonly supportDigest?: string
  readonly origin: WriteOrigin
  readonly summary: string
  /** Real write-phase callback used by UnitTransaction; not persisted. */
  readonly onPhase?: (phase: 'target-pending' | 'target-applied' | 'target-written' | 'source-archiving' | 'sources-archived' | 'support-pending' | 'unit-written', detail?: { source?: string }) => void | Promise<void>
  /** Phase-boundary cancellation; checked before target/source writes. */
  readonly signal?: AbortSignal
  /** Tree-fence guard; checked before every tree/source write. */
  readonly assertFence?: () => Promise<boolean>
}

export interface CommitMergeResult {
  readonly ok: boolean
  readonly message: string
  /** Typed refusal kind for the revision CAS (target/source/support changed after the plan). */
  readonly code?: 'target-changed' | 'source-changed' | 'support-changed'
  readonly unitId?: string
  readonly targetPath?: string
  readonly archived?: readonly string[]
  /** One per skill written: target + each source. */
  readonly mutations?: number
}

export function skillsRoot(env: NodeJS.ProcessEnv = process.env): string {
  // V9-05 (0.3.51): single resolver — evolutionRoot() holds the ONLY
  // DSH_HOME empty/whitespace fallback; the old bare `||` here resolved
  // `DSH_HOME=" "` to a CWD-relative " /skills" sidecar.
  return join(evolutionRoot(env), 'skills')
}

/** 0.3.18 (S4.1, E-30): the ONE root resolution for every member that reads
 * the skills tree — tool-skill-manage / evolution-skill-catalog / skill-usage
 * / evolution-learning-graph used to each resolve `config.root || skillsRoot()`
 * (and the graph ignored config entirely). Empty/whitespace config falls
 * through to the default; callers pass their raw Config. The optional field is
 * declared `| undefined` so a config object whose root field is explicitly
 * `string | undefined` still assignable under exactOptionalPropertyTypes.
 * P2-31 core half (S2.2 batch, PLAN 2026-09-16): an explicit non-empty root
 * is `resolve()`d — the same normalization `evolutionRoot` applies and the
 * same one upstream skill-filesystem applies to `customSkillDirs`
 * (`(config.customSkillDirs ?? []).map(root => resolve(root))`). The former
 * verbatim return left a RELATIVE config root CWD-relative, so the family's
 * skill tree moved with the host process's launch directory while every
 * absolute consumer (watchers, the platform catalog) resolved it — a
 * split-brain tree; a trailing slash or `..` segment likewise landed
 * unnormalized. A clean absolute root is byte-identical (resolve is a no-op). */
export function resolveSkillsRoot(config: { root?: string | undefined } = {}): string {
  const explicit = (config.root ?? '').trim()
  return explicit ? resolve(explicit) : skillsRoot()
}

/** E-7 (v18) → V27 G2.4 (M-08): every family row reads ONE root key. `root` is
 * canonical; the `skillsRoot` alias was honoured for one minor version and its
 * window closed at 0.3.65 — it is now two releases past expiry, so this
 * resolver no longer reads it at all. A deployment that still sets the alias
 * must fail LOUDLY at load (see {@link assertSkillsRootAliasRetired}): silently
 * ignoring a config key leaves the deployment pointing at a root nobody reads,
 * which is the worst form of compatibility.
 * @param config - the raw plugin config.
 * @returns the effective root (empty when the key is unset or blank).
 */
export function resolveRootConfig(config: { root?: string | undefined } = {}): { root: string } {
  return { root: (config.root ?? '').trim() }
}

/** V27 G2.4 (M-08): the retirement gate for the expired `skillsRoot` alias.
 * Called at each plugin's load boundary (before the root is resolved), it turns
 * a stale key into an explicit load error naming the replacement — the
 * fail-loud form the plan requires instead of a silent no-op.
 * @param config - the raw plugin config (the alias field stays DECLARED in each
 * schema so the loader can hand it here instead of dropping it).
 */
export function assertSkillsRootAliasRetired(config: { skillsRoot?: string | undefined } = {}): void {
  if ((config.skillsRoot ?? '').trim() !== '') {
    throw new Error('evolution: config "skillsRoot" was removed after 0.3.65 — rename the key to "root" (the alias is no longer honoured)')
  }
}

/**
 * Map a requesting session onto the two origin surfaces (rc.44 plan M2-2.3):
 * the APPROVAL surface treats every delegated subagent as the autonomous
 * review channel, while the LIBRARY surface keeps the Hermes distinction -
 * the review fork is 'background_review' (the pinned guard blocks its
 * writes) and any other subagent is 'subagent' (agent-authored, not
 * review-channel). `isReview` marks the caller as the background review
 * pipeline itself. Single source: the two tools and the review executor all
 * read this table instead of re-deriving it.
 */
export function resolveOrigins(
  headerOrigin: string | undefined,
  isReview = false,
): { approval: 'foreground' | 'background_review'; library: WriteOrigin } {
  if (isReview) return { approval: 'background_review', library: 'background_review' }
  if (headerOrigin === 'subagent') return { approval: 'background_review', library: 'subagent' }
  return { approval: 'foreground', library: 'foreground' }
}

/** Minimal structural view of a tool execution context, so the helper below
 * stays decoupled from the platform's exec type (extra fields are ignored). */
export interface EvolutionExecOriginView {
  agent?: {
    session?: {
      id?: unknown
      header?: { origin?: string }
    }
  }
}

/**
 * S1-E8 (0.3.80): ONE exec→origins resolution for the two write tools — reads
 * the session header origin AND the v37 S2.2 review-channel session mark, so a
 * tool cannot forget the mark half (tool-memory shipped without it, which
 * mislabeled every inject-mode review memory write as `foreground` and let it
 * bypass staging under `stageForeground: false`).
 * Single source: both tools call this instead of re-deriving the pair.
 */
export function resolveExecOrigins(
  exec: EvolutionExecOriginView | undefined,
): { approval: 'foreground' | 'background_review'; library: WriteOrigin } {
  const session = exec?.agent?.session
  return resolveOrigins(
    session?.header?.origin,
    isReviewChannelSession(typeof session?.id === 'string' ? session.id : undefined),
  )
}

function skillDir(root: string, name: string): string {
  return join(root, name)
}

/** Dot-prefixed on-disk marker name. SINGLE source: `list()` matches directory
 * entries against this name, and path builders must never hardcode a marker
 * literal (N-1: the rc.49 exists()-probe convergence dropped the dot,
 * poisoning every protectedBy/managed report). Exported for cross-package
 * consumers that must probe markers without re-deriving the name (curator's
 * archive-copy bundled probe, 0.3.26 V4-02). */
export function markerEntryName(marker: 'bundled' | 'hub-installed' | 'pinned' | 'hermes-managed'): string {
  return `.${marker}`
}

/** v23 (ML-1): `.archive` retention window (see pruneExpiredArchives). */
const ARCHIVE_RETENTION_DAYS = 365

function markerPath(dir: string, marker: 'bundled' | 'hub-installed' | 'pinned' | 'hermes-managed'): string {
  return join(dir, markerEntryName(marker))
}

function isCommittedOnly(error: unknown): boolean {
  return isCommittedWarning(error)
}

/** v28 G2.5 (CORE-SK-03): every pre-clear refusal in restoreSnapshotIntoRoot
 * says "refus…" (manifest / traversal / live-writer gates) or "is incomplete"
 * (completeness gate). Anything else thrown from that method means the
 * destructive clear already happened and a rollback is load-bearing. */
function isPreClearRefusal(message: string): boolean {
  return message.includes('refus') || message.includes('is incomplete')
}

async function listNames(root: string, io: EvolutionIoLike): Promise<string[]> {
  const entries = await io.list(root)
  const names: string[] = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    if (await io.exists(join(root, entry, 'SKILL.md'))) names.push(entry)
  }
  return names.sort()
}

/** C-18: support file names are restricted to the
 * RESTRUCTURE_TARGET_RE character class (leading `[a-z0-9]`, then
 * `[a-z0-9._-]`) — drive-colon / odd-character / uppercase names can no
 * longer reach the filesystem through writeSupportFile / patch /
 * removeSupportFile. */
const SUPPORT_FILE_NAME_RE = SUPPORT_ENTRY_NAME_RE

/** C-18: win32 reserves these stems with ANY extension (`nul.md` hits the
 * NUL device), and they are fully inside the charset above — so the reserved
 * set is checked on the first-dot prefix as well; the charset close alone
 * cannot refuse them. Exported single source: `badName` (skill directories,
 * P2-11/v15) and `validateSupportPath` (support-file stems, C-18) both
 * consume this one set — a third copy would drift. */
const WIN32_RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** A1-6 (v18): the regex alone admits `references/nul.md` (a Windows device
 * stem), which the support-file layer refuses. Restructure must use the same
 * rule, or it creates an orphan the later patch/write/remove paths refuse.
 * Single source shared with the plan validator. */
export function validateRestructureTarget(filePath: string): string | null {
  if (!RESTRUCTURE_TARGET_RE.test(filePath)) return `toFile must be references/<topic>.md (got "${filePath}").`
  const file = filePath.slice(filePath.lastIndexOf('/') + 1)
  const stem = file.split('.')[0]?.toLowerCase() ?? ''
  if (WIN32_RESERVED_DEVICE_NAMES.has(stem)) return `toFile "${filePath}" uses a Windows reserved device name.`
  return null
}

export function validateSupportPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.includes('..')) return '不允许路径穿越。'
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0 || !SUPPORT_DIRS.includes(parts[0] as typeof SUPPORT_DIRS[number])) {
    return `file_path must be under one of: ${SUPPORT_DIRS.join(', ')}.`
  }
  if (parts.length < 2) return '请给出文件名，不能只给目录。'
  for (const part of parts.slice(1)) {
    if (!SUPPORT_FILE_NAME_RE.test(part)) {
      return `不支持的文件名「${part}」：请只用小写字母、数字、点、连字符和下划线（首字符须为字母或数字）。`
    }
    // G2 S4: the `.lock` suffix is no longer reserved. It was reserved because a user file named
    // `*.lock` was indistinguishable from the io writer lock; that protocol is retired (writes go
    // through the provider's versioned writes), so the name is a user file name like any other.
    // A1-1 (v18): `.corrupt` and `.tmp` are the io layer's protocol artifacts
    // (quarantine copy / durable-write tmp). A user support file with either
    // suffix was eligible for sweepStaleTmps deletion; reserve them too.
    if (part.toLowerCase().endsWith('.corrupt') || part.toLowerCase().endsWith('.tmp')) {
      return `不支持的文件名「${part}」：.corrupt/.tmp 后缀由状态与 IO 协议保留。`
    }
    const stem = part.split('.')[0]?.toLowerCase() ?? ''
    if (WIN32_RESERVED_DEVICE_NAMES.has(stem)) {
      return `不支持的文件名「${part}」：这是 Windows 保留设备名。`
    }
  }
  return null
}

/**
 * Index of `pattern` inside `content`, treating whitespace runs (spaces/tabs)
 * as flexible and literal escape sequences (`\n`, `\t`, `\r`) as their real
 * characters: a PATTERN whitespace run matches any content run of any length
 * (even empty), while extra whitespace that only exists in the content is not
 * skipped — the flexibility is one-sided on the pattern, and a backslash-
 * escaped char in the pattern matches the real char in the content
 * (model-copy drift). Returns the [start, end) range in the ORIGINAL content
 * so a patch can replace exactly the matched span and keep every other byte
 * intact. Returns null when no fuzzy match exists.
 */
interface PlannedRestructureSection {
  rel: string
  heading: string
  text: string
}

/** Planned section extraction (pure; no IO): new body + extracted section texts. */
type RestructurePlan = { error: string } | { body: string; sections: PlannedRestructureSection[] }


/**
 * One content write of a tree-change plan; `target` is an absolute path.
 * `expected` (v24 V24-01) is the PLAN-TIME bytes the caller built `content`
 * from — the same read `content` was composed over. When present, the commit
 * CAS compares the disk against `expected` instead of the kernel's own
 * just-before-commit pre-read: a concurrent writer landing between planning
 * and commit must abort the plan (drift), not silently win a silent-overwrite
 * baseline. Omit it only for writes whose content does not derive from a
 * plan-time read.
 */
interface TreeChangeWrite {
  target: string
  content: string
  expected?: string | null
  /** Skill this path belongs to; omitted on the legacy single-root plan. */
  skill?: string
}

/** One deletion in a tree-change plan; expected is the plan-time baseline for CAS. */
interface TreeChangeDelete {
  target: string
  expected?: string | null
  skill?: string
}

/** Ordered write/delete operation. ops takes precedence over writes/deletes when present. */
type TreeChangeOp =
  | { kind: 'write'; target: string; content: string; expected?: string | null; skill?: string }
  | { kind: 'delete'; target: string; expected?: string | null; skill?: string }

/** One declared root; names are validated and each root's own protection applies. */
interface TreeChangeRoot {
  name: string
  protection: 'write' | 'delete' | 'none'
}

/**
 * Deterministic tree-change plan (009 kernel): a batch of content writes (and,
 * for multi-root extract, deletes) with one commit point. The kernel owns
 * validation order, pre-read versions, rollback bytes, audit and the mutation
 * event — mutators compose plans, they never implement two-phase commit
 * themselves.
 */
interface TreeChangePlan {
  /** Primary/legacy skill; also the first root when roots is absent. */
  name: string
  origin: WriteOrigin
  /** Legacy root protection; ignored when roots is present. */
  protection: 'write' | 'delete' | 'none'
  /** Explicit roots for a cross-skill unit; first root must include name. */
  roots?: TreeChangeRoot[]
  writes: TreeChangeWrite[]
  deletes?: TreeChangeDelete[]
  /** Ordered operations; when present, writes/deletes are ignored. */
  ops?: TreeChangeOp[]
  auditAction: string
  auditSummary: string
  eventAction: string
  // G3a: the unit this plan belongs to. A user-level operation that fans out into SEVERAL tree
  // writes (restructure writes a support file and then the body) mints ONE id and hands it to every
  // plan it composes, so the entries they record are pruned and undone as one unit. Absent ⇒ the
  // tree change mints its own (a single-write operation is a unit of one).
  unitId?: string
  /** Override the kernel-computed head (a merge names both the target and every archived source). */
  unitHead?: UnitHead
}

function planRestructureSections(body: string, moves: SkillRestructureMove[]): RestructurePlan {
  // One scan (h2Sections) and one selection rule; extract reuses the same
  // selector for start/end sub-blocks, so restructure and extract cannot drift
  // on heading ambiguity, empty sections or duplicate moves.
  const selection = selectSections(body, moves.map(move => ({ heading: move.heading })))
  if (!selection.ok) return { error: selection.message }
  const lines = body.split('\n')
  const spans = selection.sections.map(section => {
    const move = moves[section.requestIndex]
    return {
      start: section.start,
      end: section.end,
      rel: move?.toFile ?? '',
      heading: section.heading,
      text: section.text,
    }
  })
  // Rebuild the body line-wise: a moved section collapses to its pointer line.
  const byStart = new Map(spans.map(span => [span.start, span]))
  const rebuilt: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const span = byStart.get(i)
    if (span) {
      rebuilt.push(...pointerBlock(span.rel, span.text))
      i = span.end - 1
    } else {
      rebuilt.push(lines[i] ?? '')
    }
  }
  return { body: rebuilt.join('\n'), sections: spans.map(({ rel, heading, text }) => ({ rel, heading, text })) }
}

/**
 * One single-file read-modify-write outcome: the caller-facing result, the
 * next bytes to write (`write: null` = leave the file untouched), the audit
 * record and the mutation event. Audit/notify fire only when `write` landed.
 */
interface SingleWriteOutcome {
  result: SkillActionResult
  write: string | null
  audit?: { skillName: string; action: string; before: string | null; after: string | null; summary: string; path?: string }
  event?: EvolutionSkillMutatedEvent
  hardCapHit?: { bodyChars: number; supportFiles: number | null }
}

/**
 * WHY MODULE SCOPE (S4.4): the serial queue must be shared ACROSS SkillLibrary instances. Six services
 * each build their own store over the SAME skill root (tool face / curator face / review face), and a
 * per-instance queue - which is what `this.serial = makeSerialQueue()` was - let two of them run
 * read->plan->commit against one tree at the same time. The mutex cannot live on an instance because
 * instances share nothing (S2-02, G1/1.4); it cannot be a file lock either, because the point is to
 * order IN-PROCESS phases before the io transact layer sees them. Keyed by root: two roots are
 * independent trees and must not wait on each other.
 */
const ROOT_SERIAL = new Map<string, ReturnType<typeof makeSerialQueue>>()

/** The ONE queue for a skill root, created on first use (module scope, see above).
 * @param root - the resolved skill root; the key, so two spellings of one directory share a queue.
 * @returns the queue every instance over this root serializes through.
 */
function serialForRoot(root: string): ReturnType<typeof makeSerialQueue> {
  const key = resolve(root)
  const existing = ROOT_SERIAL.get(key)
  if (existing !== undefined) return existing
  const created = makeSerialQueue()
  ROOT_SERIAL.set(key, created)
  return created
}
/** Same-content test for two revision anchors (absent only equals absent). */
function sameRevisionAnchor(expected: RevisionAnchor, live: RevisionAnchor): boolean {
  if (expected.kind !== live.kind) return false
  return expected.kind === 'absent' || expected.sha256 === (live as { readonly sha256: string }).sha256
}

export class SkillLibrary {
  readonly root: string
  /** The ONE read face owner/health/panel consume; a thin adapter, not a store. */
  readonly model: SkillModel
  readonly limits: SkillLimits
  private readonly io: EvolutionIoLike
  private readonly onMutation: ((event: EvolutionSkillMutatedEvent) => void) | undefined
  /** 0.3.21 (F-208) + V4-20: cross-process RMW transactor. An explicitly
   * injected value wins; otherwise the IO backend's own `transact` is bound
   * when it provides one (cross-process atomicity on by default for any
   * transact-capable backend), and a backend without `transact` leaves this
   * undefined (each write falls back to the plain read→task→write path). */
  private readonly transact: (typeof transactIo) | undefined
  /** 0.3.21 (F-208): in-process serialize queue so two concurrent mutators on
   * one skill never interleave their read-modify-write (the cross-process layer
   * is the IO backend's transact lock; this chain is the second layer). */
  private readonly serial: <T>(task: () => Promise<T>) => Promise<T>
  /** V10-03 (P2-18): see the constructor's threatExemptLabels. Empty by
   * default — the strict ANY-hit-blocks policy is unchanged. */
  private readonly threatExemptLabels: readonly string[]
  /** G1/1.1: default authority; a call may override (origin is per-invocation). */
  /** G1/1.1/Stage 2: the ONE default every mutator reads. Per-call overrides still win. */
  private readonly authority: WriteAuthority
  /** skill-history.ts: the content history is best-effort, so a failure must not be SILENT —
   * but it is a deployment condition, not a per-write event, so it warns once per instance. */
  private historyWarned = false

  constructor(
    root = skillsRoot(),
    io: EvolutionIoLike = nodeEvolutionIo(),
    limits: SkillLimits = DEFAULT_SKILL_LIMITS,
    onMutation?: (event: EvolutionSkillMutatedEvent) => void,
    transact?: typeof transactIo,
    threatExemptLabels?: readonly string[],
    authority: WriteAuthority = CLASS_DEFAULT_AUTHORITY,
  ) {
    this.root = root
    this.io = io
    this.limits = limits
    this.onMutation = onMutation
    this.threatExemptLabels = threatExemptLabels ?? []
    this.authority = authority
    // V4-20: bind the IO backend's own transact by default. Explicit injection
    // stays first; a backend WITHOUT transact keeps the old plain read→write
    // (the in-process serial chain is the second layer). The wrapper adapts the
    // backend's `(path, task)` instance signature to the standard `(io, path,
    // task)` form the rest of the core expects, guarding the optional method
    // rather than asserting it.
    this.transact = transact ?? (io.transact
      ? (ioLike, path, task) => {
        const t = ioLike.transact
        return t ? t(path, task) : transactIo(ioLike, path, task)
      }
      : undefined)
    // G1/1.4 (S2-02): the queue is per ROOT and shared by every instance (see ROOT_SERIAL above); a
    // per-instance queue ordered nothing across the six services that write this tree.
    this.serial = serialForRoot(this.root)
    this.model = new SkillModel({
      list: async query => await this.list(query),
      read: async name => await this.read(name),
      listSupportFiles: async name => {
        const probe = await this.listSupportFiles(name)
        if (!isPresent(probe)) throw new Error('support listing unreadable for ' + name)
        return probe.value
      },
      readSupportFile: async (name, path) => await this.readSupportFile(name, path),
    })
  }

  /**
   * Transitional root lock for mutators that still own their write path. The
   * extract/restructure path takes the same lock through MutationUnit, so those
   * two paths cannot interleave with create/update/patch across processes.
   */
  private unitHeadForOps(ops: readonly import('./mutation-unit.ts').MutationSnapshotOp[], roots: readonly string[], provenance: ReadonlyMap<string, string> = new Map()): UnitHead {
    const moves: Array<Record<string, unknown>> = []
    for (const op of ops) {
      if (op.skill === undefined || basename(op.target) === 'SKILL.md') continue
      const path = relative(this.dirOf(op.skill), op.target).split(String.fromCharCode(92)).join('/')
      if (path === '' || path.startsWith('..')) continue
      moves.push({
        path,
        kind: op.before === null ? 'created' : op.after === null ? 'removed' : 'moved',
        ...(op.before === null ? {} : { beforeRef: contentHash(op.before) }),
        ...(op.after === null ? {} : { afterRef: contentHash(op.after) }),
        ...(provenance.get(op.target) === undefined ? {} : { provenance: provenance.get(op.target) }),
      })
    }
    return { moves, sources: roots.map(skill => ({ skill })) }
  }

  private async withMutationLock<T>(task: () => Promise<T>): Promise<T> {
    let lease: import('./mutation-unit.ts').MutationLockLease | undefined
    try {
      lease = await fileMutationLock(this.io, this.root).acquire()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('mutation-lock-busy')) throw error
      // Coordination failure: the per-file transact/serial path remains the
      // fallback; a lock sidecar must not change the mutation's business result.
      return await task()
    }
    try {
      return await task()
    } finally {
      try {
        await lease.release()
      } catch {
        // A failed lock cleanup is a coordination degradation, not a write failure.
      }
    }
  }

  private recovery: Promise<void> | undefined

  /** Run the boot recovery once per library instance, before the first write. */
  private async ensureRecovered(): Promise<void> {
    this.recovery ??= this.recoverPreparedUnits().then(() => undefined).catch(error => {
      console.warn('skill-store: prepared-unit recovery failed; writes continue: ' + (error instanceof Error ? error.message : String(error)))
    })
    await this.recovery
  }

  /** Public boot hook: idempotent with the first-write recovery. */
  async recoverOnBoot(): Promise<void> {
    await this.ensureRecovered()
  }

  /** Recover every prepared tree-change snapshot in the shared unit store. */
  async recoverPreparedUnits(): Promise<MutationResult[]> {
    const home = dirname(this.root)
    const unit = new MutationUnit({
      io: this.io,
      limits: { maxSkillFileBytes: this.limits.maxSkillFileBytes, maxSkillContentChars: this.limits.maxSkillContentChars },
      serial: this.serial,
      lock: fileMutationLock(this.io, this.root),
      journal: unitJournalPort(this.io, home),
      snapshots: unitSnapshotPort(this.io, home),
    })
    return await unit.recoverPrepared()
  }

  /**
   * Run one single-file read-modify-write for a mutator. When `transact` was
   * injected the read and the write run inside it (cross-process atomicity);
   * otherwise a plain read → task → write sequence runs (the process-level
   * `serial` chain is the second layer). `task` receives the current content
   * (null when missing) and returns a {@link SingleWriteOutcome}. Audit and the
   * mutation event are issued ONLY when a write actually lands, so a no-op
   * never inflates the mutation-maturity counter.
   */
  /**
   * v28 G1.1 (EVO-IO-02): shared compensating cleanup for a locked write that
   * found no SKILL.md — remove the possibly-resurrected directory ONLY when it
   * holds nothing but this path's own write-lock file. The BR-5 rule from
   * setPinnedCore/createCore applies unchanged: a concurrent mover can land a
   * full directory between the list probe and the remove, so ANY content at all (support files, a
   * fresh restore) must never be recursed away. Best-effort: a failed cleanup leaves the "not found" result
   * unchanged (the operator-facing ghost-dir refusal is fail-loud already).
   */
  private async cleanupGhostDir(skillFilePath: string): Promise<void> {
    const dir = dirname(skillFilePath)
    try {
      const leftovers = await this.io.list(dir)
      // G2 S4: the old rule also tolerated this path's own write-lock file; that protocol is retired,
      // so "empty" is the whole test.
      if (leftovers.length > 0) return
      await this.io.remove(dir)
    } catch {
      // Leave the ghost; restore/archive report it with repair instructions.
    }
  }

  /** Notify the mutation observer after a successful write; observers must never fail the mutation. */
  private notifyMutation(event: EvolutionSkillMutatedEvent): void {
    try {
      this.onMutation?.(event)
    } catch {
      // Observers (catalog invalidation) are advisory; a throwing listener must
      // not surface after the mutation already landed.
    }
  }

  /** V10-03 (P2-18): ScanOptions shared by every write-path threat check —
   * the constructor's exempt labels, empty by default (behavior unchanged). */
  private threatScanOptions(): ScanOptions {
    return this.threatExemptLabels.length > 0 ? { excludeLabels: this.threatExemptLabels } : {}
  }

  /** V10-03 (P2-18): the strict-scan write gate. A block message names the hit
   * label (scanContentThreats already embeds it) plus the self-heal hint, so a
   * false-positive rewrite direction is actionable instead of a dead end. */
  private contentThreatBlock(content: string): string | null {
    // A2-16 (v18): scanContentThreats already appends its exemption hint;
    // a store-side append duplicated the sentence (the old THREAT_EXEMPT_HINT
    // export was removed in v21 — see threats.ts THREAT_EXEMPTION_HINT).
    return scanContentThreats(content, undefined, this.threatScanOptions())
  }

  /**
   * v30 REV-03: read a support file's bytes for staleness anchoring (the
   * write/remove replay guard). Same validation as writeSupportFile; a
   * missing file (or a directory squatting on the path) reads as `null`, any
   * other failure RETHROWS — the callers are the staging/replay anchors, and
   * a swallowed error would silently downgrade the anchor to
   * last-writer-wins.
   */
  /**
   * S4-01 (G0/0.7): the ONE three-state read the staging/replay anchors use.
   *
   * The two absorbing reads below absorb ENOENT/EISDIR and rethrow everything else, and the callers then
   * each wrote their own try/catch to turn a rethrow into a decision - three near-copies of one posture,
   * and the newest of them silently dropped the anchor instead of refusing. A read failure is its own
   * state, so it gets its own name here: `unknown` with the reason, next to `present` and `absent`.
   * Failing closed is then the CALLER decision (they refuse on unknown), not something each call site has
   * to re-derive from a thrown error.
   */
  async readSkillProbe(rawName: string): Promise<Probe<string>> {
    return await this.probeOf(() => this.read(rawName))
  }

  /** The support-file face of {@link readSkillProbe}. */
  async readSupportFileProbe(rawName: string, filePath: string): Promise<Probe<string>> {
    return await this.probeOf(() => this.readSupportFile(rawName, filePath))
  }

  /** One place that turns the absorbing reads into three states. `null` is absent; a throw is unknown. */
  private async probeOf(read: () => Promise<string | null>): Promise<Probe<string>> {
    try {
      const value = await read()
      return value === null ? probeAbsent() : probePresent(value)
    } catch (error) {
      return probeUnknown(probeReason(error))
    }
  }

  async readSupportFile(name: string, filePath: string): Promise<string | null> {
    const bad = this.badName(name, { allowReserved: true })
    if (bad) throw new Error(bad)
    const validation = validateSupportPath(filePath)
    if (validation) throw new Error(validation)
    const dir = this.dirOf(name)
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    try {
      return await this.io.readText(target)
    } catch (error) {
      // v30 REV-03: 'absent' is a first-class anchored state — a MISSING file
      // reads as null so the staging/replay anchor can pin "did not exist
      // yet". EISDIR (a directory on the path) reads as null too (no bytes).
      // Any other failure (EACCES…) rethrows: the anchor must not silently
      // degrade to last-writer-wins.
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      // v43 S1-4: deliberately NOT core/probe.ts's isMissingPath — EISDIR is
      // "wrong path shape", not "absent", and merging would swallow it here.
      if (code === 'ENOENT' || code === 'EISDIR') return null
      throw error
    }
  }

  /**
   * Summarize the skill tree.
   * @param options - `withContent` attaches each skill's whole SKILL.md body to
   * its summary (v35 C11), `withFrontmatter` its parsed frontmatter record
   * (T2-07/A22): the read this listing already performs is the one either would
   * cost again, so a caller pays no second pass over the tree.
   * @returns one summary per readable skill directory.
   */
  /** T2-V2/A27: the skill names the TREE holds — the same listing rule {@link list} applies (dot
   * entries skipped, a SKILL.md must exist), WITHOUT reading any SKILL.md. A consumer that needs the
   * member set rather than the summaries (the learning graph's node set) pays one directory listing
   * instead of a whole-tree read pass.
   * @returns the sorted skill directory names. */
  async treeNames(): Promise<string[]> {
    return await listNames(this.root, this.io)
  }

  async list(options: { withContent?: boolean; withFrontmatter?: boolean } = {}): Promise<SkillSummary[]> {
    const summaries: SkillSummary[] = []
    // G1/1.7 (S7-01): ONE listing plus ONE read per skill. The loop used to go through `listNames`,
    // which probes `exists(SKILL.md)` for every entry - so every name cost an existence call AND then a
    // read of the same file. Existence IS the read here: a missing SKILL.md answers null and the entry is
    // skipped, exactly as the probe-then-read pair did (a real read failure still throws, unchanged).
    for (const entry of await this.io.list(this.root)) {
      if (entry.startsWith('.')) continue
      const name = entry
      const dir = this.dirOf(name)
      // v29 LIST-01 + v30 REG-01: ONLY the EISDIR shape is absorbed (a
      // directory squatting on the SKILL.md path — the E-43 form `read()`
      // also absorbs). The v29 cut swallowed every error here: one TRANSIENT
      // EACCES (win32 AV/indexer hold) silently dropped a LIVE skill from
      // `treeNames`, and the curator's E-15 fold — which assumes a missing
      // tree name means "the archive rename already landed" — permanently
      // marked it archived in the usage sidecar with no self-heal. Any other
      // read failure now fails loud exactly like the pre-v29 behavior.
      let md: string | null
      try {
        md = await this.io.readText(join(dir, 'SKILL.md'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'EISDIR') continue
        throw error
      }
      // C-14: a 0-byte SKILL.md is "present but corrupt" — listNames
      // already proved the file exists, so the entry stays visible (parseFrontmatter
      // of '' yields no description) instead of being ghost-skipped: scope and
      // curator must still see a directory that may carry protection markers.
      // Only a missing read (null — a lost race against an archive) skips.
      if (md === null) continue
      const parsed = parseFrontmatter(md)
      // One directory listing replaces the per-marker exists() probes (P2-6
      // N+1 convergence); the marker set matches deleteProtection(). Names are
      // matched through markerEntryName() so the scan sees exactly the names
      // markerPath() would probe (N-1).
      // A1-17 (v18): a listing failure is NOT "no markers". The pre-P2-6 code
      // probed each marker with exists(), and losing that distinction made a
      // protected skill read as unprotected. Keep the listing fast path, fall
      // back to the per-marker probes on the error path, and report `null`
      // (unknown) when even the probes fail.
      let entries: string[] | null = null
      try {
        entries = await this.io.list(dir)
      } catch {
        entries = null
      }
      type Marker = 'bundled' | 'hub-installed' | 'pinned' | 'hermes-managed'
      const probeMarker = async (marker: Marker): Promise<boolean | null> => {
        if (entries !== null) return entries.includes(markerEntryName(marker))
        try {
          return await this.io.exists(join(dir, markerEntryName(marker)))
        } catch {
          return null
        }
      }
      const [bundled, hubInstalled, pinned, hermesManaged] = await Promise.all([
        probeMarker('bundled'), probeMarker('hub-installed'), probeMarker('pinned'), probeMarker('hermes-managed'),
      ])
      const protectedBy = bundled === true ? 'bundled' : hubInstalled === true ? 'hub-installed' : pinned === true ? 'pinned' : null
      // C-17: type-gate the description — a corrupt frontmatter value
      // (e.g. `description: 123` surviving as a number) must not leak into the
      // string-typed summary field.
      const parsedDescription = parsed?.frontmatter.description
      // E-11 (v18): type-gate like the description — upstream throws on a
      // non-string whenToUse, so only a non-empty string is published.
      const parsedWhenToUse = parsed?.frontmatter.whenToUse
      summaries.push({
        name,
        description: typeof parsedDescription === 'string' ? parsedDescription : '',
        path: dir,
        protectedBy,
        protectionUnknown: [bundled, hubInstalled, pinned, hermesManaged].some(value => value === null),
        managed: hermesManaged === true,
        ...typeof parsedWhenToUse === 'string' && parsedWhenToUse.trim() !== '' ? { whenToUse: parsedWhenToUse } : {},
        ...options.withContent === true ? { content: md } : {},
        ...options.withFrontmatter === true && parsed !== null ? { frontmatter: parsed.frontmatter } : {},
      })
    }
    return summaries
  }

  async read(rawName: string): Promise<string | null> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    // Defensive: an invalid name must never escape the skills root via join().
    if (this.badName(name) !== null) return null
    // 0.3.16 (E-43): a DIRECTORY squatting on SKILL.md (EISDIR) reads as
    // absent for the library surface — but readText itself keeps throwing so
    // the event-log rotation can still FLAG a malformed archive slot (rc.72
    // G-2). Only this read boundary absorbs it.
    try {
      return await this.io.readText(join(this.dirOf(name), 'SKILL.md'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'EISDIR') return null
      throw error
    }
  }

  /**
   * Content anchor of one live skill: name + body + every support file under SUPPORT_DIRS.
   *
   * This is the commit-side counterpart of the decision-time anchor recorded by the merge
   * domain (see skill-revision.ts): both sides call the same fingerprint, so a changed
   * source, target or support file cannot slip past the commit CAS.
   * @param rawName - caller-supplied skill name (trimmed here).
   * @returns present anchor, or absent when the skill has no SKILL.md.
   */
  async revisionFingerprint(rawName: string): Promise<string | null> {
    const name = rawName.trim()
    if (this.badName(name) !== null) return null
    let body: string | null
    try {
      body = await this.io.readText(join(this.dirOf(name), 'SKILL.md'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'EISDIR') return null
      throw error
    }
    if (body === null) return null
    return revisionFingerprint(name, body, await this.liveSupportFiles(name))
  }

  /** Content anchor of one live skill; the hash a decision records and a commit re-checks. */
  async revisionAnchor(rawName: string): Promise<RevisionAnchor> {
    const fingerprint = await this.revisionFingerprint(rawName)
    return fingerprint === null ? { kind: 'absent' } : { kind: 'present', sha256: contentHash(fingerprint) }
  }

  /** Every support file of one live skill, in listing order; unreadable/missing files fail loud. */
  async liveSupportFiles(rawName: string): Promise<readonly RevisionFile[]> {
    const name = rawName.trim()
    if (this.badName(name) !== null) return []
    const listed = await this.listSupportFiles(name)
    if (isUnknown(listed)) throw new Error('support file list is unknown: ' + name)
    if (!isPresent(listed)) return []
    const dir = this.dirOf(name)
    return await Promise.all(listed.value.map(async path => {
      const content = await this.io.readText(join(dir, ...path.replace(/\\/g, '/').split('/').filter(Boolean)))
      if (content === null) throw new Error('support file disappeared: ' + name + '/' + path)
      return { path, content }
    }))
  }

  /**
   * Single path-building choke point (rc.42 audit P2-5): every directory path

   * is built from the TRIMMED name, so a name that passes `badName` (which

   * trims before validating) can never mint a second, whitespace-padded

   * directory next to the real one. Callers keep passing raw user input.

   */

  private dirOf(name: string): string {

    return skillDir(this.root, name.trim())

  }



  /**
   * Name-format guard for every path-building entry point (P1-1/v14 closed the
   * one gap: `patch`). Write paths, protection probes and support-file
   * enumeration all call it before `dirOf`, so no directory path is ever built
   * from a name that could escape the skills root. `list()` and `snapshotAll()`
   * are the deliberate exceptions — their names come from `listNames()`, i.e.
   * from the tree itself, never from caller input.
   */
  private badName(name: string, opts: { allowReserved?: boolean } = {}): string | null {
    const normalized = name.trim()
    if (!SKILL_NAME_RE.test(normalized) || normalized.length > this.limits.maxNameLength) {
      return `技能名「${normalized}」不合法：请只用小写字母、数字和连字符（不超过 ${this.limits.maxNameLength} 个）。`
    }
    // P2-11 (v15): win32 reserves these stems for ANY directory component —
    // the same set the support-file layer has refused since C-18 — so a skill
    // directory named `nul`/`com1` would die with a raw system errno instead
    // of a structured refusal. POSIX deployments lose nothing real: these
    // stems are device mnemonics, not useful skill names (fail-closed).
    // P3 (v16): the MOVERS (archive / restoreFromArchive) pass
    // `allowReserved` — refusal here would strand legacy reserved-name skills
    // created before this guard with no API path to archive or recover them.
    if (!opts.allowReserved && WIN32_RESERVED_DEVICE_NAMES.has(normalized)) {
      return `"${normalized}" is a Windows reserved device name and cannot be used as a skill name.`
    }
    return null
  }

  /**
   * Refusal reason for a write to `rawName`, or null when the write may
   * proceed: a protection marker on the directory, or an invalid name
   * (P1-1/v14 — the name guard lives HERE as well as at every entry point, so
   * no caller can build a path from an unvalidated name).
   */
  async writeProtection(rawName: string, origin: WriteOrigin = this.authority.origin): Promise<string | null> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()
    const badName = this.badName(name)
    if (badName) return badName

    const dir = this.dirOf(name)
    for (const marker of ['bundled', 'hub-installed'] as const) {
      if (await this.io.exists(markerPath(dir, marker))) return marker
    }
    // Pinned means "user froze this skill": the autonomous REVIEW pipeline may
    // not rewrite it. A delegated subagent write (origin 'subagent') is an
    // agent-authored change, not the review channel — it keeps the Hermes
    // distinction where only the review fork is subject to the background guard.
    if (origin === 'background_review' && await this.io.exists(markerPath(dir, 'pinned'))) return 'pinned'
    return null
  }

  // C-13 (v10 audit): `allowBundled` accepts an explicit `undefined` (needed
  // under exactOptionalPropertyTypes) so archive() can pass its whole
  // ArchiveOptions through instead of rebuilding the object.
  async deleteProtection(rawName: string, options: { allowBundled?: boolean | undefined } = {}): Promise<string | null> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()
    // P1-1 (v14): invalid names are refused here too (same rationale as
    // writeProtection) — the returned string is the refusal reason.
    // P3 (v17): reserved names pass here — deleteProtection answers MARKER
    // protection, and archive() needs to move a legacy reserved-name skill
    // (the v16 escape hatch) without its own subsequent call being re-blocked.
    const badName = this.badName(name, { allowReserved: true })
    if (badName) return badName

    const dir = this.dirOf(name)
    const markers: ReadonlyArray<'bundled' | 'hub-installed' | 'pinned'> = options.allowBundled
      ? ['hub-installed', 'pinned']
      : ['bundled', 'hub-installed', 'pinned']
    for (const marker of markers) {
      if (await this.io.exists(markerPath(dir, marker))) return marker
    }
    return null
  }

  /** Whether the target directory exists at all (a SKILL.md-less ghost still occupies the name). */
  async skillDirExists(rawName: string): Promise<boolean> {
    const name = rawName.trim()
    if (this.badName(name) !== null) return false
    return await this.io.exists(this.dirOf(name))
  }

  async isManaged(rawName: string): Promise<boolean> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    if (this.badName(name) !== null) return false
    const dir = this.dirOf(name)
    return await this.io.exists(markerPath(dir, 'hermes-managed'))
  }

  /** Whether the skill carries the bundled marker (curator prune-builtins eligibility). */
  async isBundled(rawName: string): Promise<boolean> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    if (this.badName(name) !== null) return false
    const dir = this.dirOf(name)
    return await this.io.exists(markerPath(dir, 'bundled'))
  }

  /** Whether the skill carries the pinned marker (the marker is the factual source; usage.pinned mirrors it). */
  async isPinned(rawName: string): Promise<boolean> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    if (this.badName(name) !== null) return false
    const dir = this.dirOf(name)
    return await this.io.exists(markerPath(dir, 'pinned'))
  }

  /** Count non-empty support subdirectories (richness input for quality scoring). */
  /** G4 ⑤-d: the dangling targets THIS write introduced, as a receipt note (empty when none).
   *
   * Uses the SAME resolver as the drift signal, so a receipt and a drift row can never disagree;
   * an absent or unknown listing reports nothing rather than inventing a dead link.
   */
  private async danglingNoteFor(skillName: string, before: string, after: string): Promise<string> {
    try {
      const listing = await this.listSupportFiles(skillName)
      if (!isPresent(listing)) return ''
      const files = listing.value
      const owner = 'SKILL.md'
      const seen = new Set(resolveCitations({ content: before, file: owner, files }).dangling.map(ref => ref.target ?? ref.raw))
      const introduced = resolveCitations({ content: after, file: owner, files }).dangling
        .map(ref => ref.target ?? ref.raw)
        .filter(target => !seen.has(target))
      return introduced.length > 0 ? ' [dangling: ' + introduced.join(',') + ']' : ''
    } catch {
      return ''
    }
  }

  async countSupportDirs(rawName: string): Promise<number> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    if (this.badName(name) !== null) return 0
    const dir = this.dirOf(name)
    // N14: the read is three-state; the DEGRADATION to "0 groups" happens here,
    // on a richness input the health report already names, not inside a catch.
    const listed = await probeList(this.io, dir)
    if (!isPresent(listed)) return 0
    let count = 0
    for (const subdir of SUPPORT_DIRS) {
      if (!listed.value.includes(subdir)) continue
      const files = await probeList(this.io, join(dir, subdir))
      if (isPresent(files) && files.value.some(file => file !== '.gitkeep')) count += 1
    }
    return count
  }

  /**
   * Support-file paths (`references/x.md`) under SUPPORT_DIRS for one skill,
   * as a THREE-state read (N14): a missing skill directory is absent, an
   * unreadable one is unknown. A partial listing is unknown too — the union
   * promises the present branch is complete (011 §7 enrichment, probe reads).
   */
  async listSupportFiles(rawName: string): Promise<Probe<string[]>> {
    // P1-1 (v14): no path is built from an unvalidated name here either.
    const name = rawName.trim()
    if (this.badName(name) !== null) return probeAbsent()
    const dir = this.dirOf(name)
    const listed = await probeList(this.io, dir)
    if (!isPresent(listed)) return listed
    const out: string[] = []
    for (const subdir of SUPPORT_DIRS) {
      if (!listed.value.includes(subdir)) continue
      const files = await probeList(this.io, join(dir, subdir))
      // A subdir we cannot read makes the WHOLE listing incomplete: answer
      // unknown rather than a partial list a caller would treat as complete.
      if (isUnknown(files)) return files
      if (!isPresent(files)) continue
      for (const file of files.value) {
        if (file === '.gitkeep' || file.startsWith('.')) continue
        out.push(`${subdir}/${file}`)
      }
    }
    return probePresent(out)
  }

  /**
   * V4 (design §16.6): exact character counts of the support files that can
   * POSSIBLY exceed the content cap. The pre-filter is BYTE size, and that is
   * sound rather than approximate: a UTF-16 code unit never costs less than one
   * UTF-8 byte, so a file whose bytes are within the cap provably cannot exceed
   * the cap in characters. The returned map is therefore COMPLETE for the
   * oversize question without reading the small files.
   * @param rawName - the skill's name.
   * @returns path -> character count (possibly empty), or null when the listing or
   *   a size probe cannot answer — unknown is never an empty map.
   */
  /** A plan-time read whose bytes become a tree change's CAS baseline (`expected`). A failed read is
   * NAMED and answers `null`, which is FAIL-CLOSED at commit: the baseline is then "absent", so an
   * existing file counts as drift and the commit refuses instead of overwriting bytes nobody read
   * (N36: the failure is not silently "the file is not there").
   * @param target - the file a tree change is about to write.
   * @returns its bytes, or `null` for both "absent" and "could not read". */
  private async readForCas(target: string): Promise<string | null> {
    const probe = await probeText(this.io, target)
    if (isUnknown(probe)) {
      console.warn(`skill-store: could not read ${target} for the tree change's baseline (${probe.reason}); treating it as absent — an existing file then counts as drift and the commit refuses`)
      return null
    }
    return isPresent(probe) ? probe.value : null
  }

  async supportFileChars(rawName: string): Promise<Record<string, number> | null> {
    const name = rawName.trim()
    if (this.badName(name) !== null) return null
    const listed = await this.listSupportFiles(name)
    if (!isPresent(listed)) return null
    const dir = this.dirOf(name)
    const chars: Record<string, number> = {}
    for (const path of listed.value) {
      const full = join(dir, ...path.split('/').filter(Boolean))
      // N36: "cannot answer" stays the answer (the contract above), but a backend without the size
      // probe and a size probe that FAILED are told apart in the log instead of collapsed silently.
      let bytes: number | null = null
      if (this.io.size !== undefined) {
        try {
          bytes = await this.io.size(full)
        } catch (error) {
          console.warn(`skill-store: size of ${full} could not be read (${error instanceof Error ? error.message : String(error)}); reporting no support-file char counts`)
          return null
        }
      }
      if (bytes === null) return null
      if (bytes <= this.limits.maxSkillContentChars) continue
      const contentProbe = await probeText(this.io, full)
      if (!isPresent(contentProbe)) {
        if (isUnknown(contentProbe)) console.warn(`skill-store: ${full} could not be read (${contentProbe.reason}); reporting no support-file char counts`)
        return null
      }
      const content = contentProbe.value
      chars[path] = content.length
    }
    return chars
  }

  /**
   * Structure-health facts for one skill (rc.73 A1, 008 design): body
   * chars/density from SKILL.md, support groups from countSupportDirs, plus
   * optional usage counts (A2 churn dimension) when the caller has them.
   * Derived, never persisted. CONTRACT: `null` whenever the skill cannot be
   * read — a missing file AND any read failure (EACCES/EIO/…) both answer
   * null, so a whole health view degrades one ROW instead of throwing out of
   * its per-skill loop (A6, audit P2-10: the former code absorbed only
   * missing/EISDIR and let a transient win32 hold kill the entire view).
   */
  async assessHealth(    rawName: string,
    thresholds: SkillHealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
    counts?: { patchCount?: number; readCount?: number; hardCapHits?: number | null },
  ): Promise<SkillHealthAssessment | null> {
    try {
      const name = rawName.trim()
      const content = await this.read(name)
      if (content === null) return null
      const support = await this.listSupportFiles(name)
      const supportFiles = isPresent(support) ? support.value.length : undefined
      return assessStructureHealth({
        skillName: name,
        bodyChars: content.length,
        bodyText: content,
        supportGroups: await this.countSupportDirs(name),
        ...(supportFiles === undefined ? {} : { supportFiles }),
        patchCount: counts?.patchCount,
        readCount: counts?.readCount,
        ...(counts?.hardCapHits === undefined ? {} : { hardCapHits: counts.hardCapHits }),
      }, thresholds)
    } catch {
      return null
    }
  }

  /** S2: mechanical hard-cap event; failure must not change the refusal. */
  private async recordHardCapHit(name: string, bodyChars: number, source: 'create' | 'update' | 'patch' | 'write_file', supportFiles: number | null = null): Promise<void> {
    try {
      await appendEvolutionEvent(this.io, eventsFile(dirname(this.root)), {
        type: 'hard-cap',
        target: name,
        bodyChars,
        supportFiles,
        restructureRounds: 0,
        source,
      })
    } catch (error) {
      console.warn('skill-store: hard-cap event not recorded for "' + name + '": ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** Best-effort audit trail entry; never blocks the mutation.
   *
   * Two independent best-effort writes run here, because either one failing must not cost the
   * other: the CONTENT history (skill-history.ts, so a version can be read back at all) and the
   * mutation ledger that points at it. The history failure is not silent — a deployment whose
   * history stopped growing is a degradation worth seeing once (the ledger keeps hashes either
   * way). */
  private async audit(
    skillName: string,
    action: string,
    before: string | null,
    after: string | null,
    summary: string,
    // Which support file the bytes belong to, RELATIVE to the skill directory (absent for the body's
    // own writes): the version entry records it so a face can name the file without guessing.
    path?: string,
    // G5: who caused this write (a write face such as `foreground` / `background_review`, or a
    // migration step). Optional so existing callers keep their behaviour; the ledger stores it when
    // given, and old records without it stay readable.
    // G3a: one tree change writes N paths under ONE unit id; the entries it writes share it.
    unitId?: string,
    unitHead?: UnitHead,
    origin?: string,
  ): Promise<void> {
    const at = new Date().toISOString()
    let versions: RecordedVersions | null = null
    try {
      const keep = this.limits.versionKeep ?? DEFAULT_SKILL_VERSION_KEEP
      // `exactOptionalPropertyTypes` is on: omit the key rather than passing an explicit undefined.
      const input = {
        skillName,
        action,
        before,
        after,
        at,
        ...path === undefined ? {} : { path },
        ...unitId === undefined ? {} : { unitId },
        ...unitHead === undefined ? {} : { unitHead },
      }
      versions = await recordVersions(this.root, this.io, input, keep)
    } catch (error) {
      if (!this.historyWarned) {
        this.historyWarned = true
        console.warn(`skill-store: content history not recorded for "${skillName}" (${error instanceof Error ? error.message : String(error)}); the mutation itself landed and the audit ledger keeps its hashes`)
      }
    }
    // G4 ⑤: what THIS write introduced (and what it made worse) — never the standing backlog. The
    // judgement comes from the engine (`lintBody` → the one facts builder); a receipt must not fail
    // the mutation, so a throw here degrades to no note.
    let healthNote = ''
    // G4 ⑤-d: filled below when THIS write turns a reference into a dead link.
    // G4 ⑤-d: a write that turns a reference into a dead link says so; decided by the same resolver
    // the drift signal uses, and only for targets THIS write broke.
    const danglingNote = before === null || after === null || before === after
      ? ''
      : await this.danglingNoteFor(skillName, before, after)
    if (before !== null && after !== null && before !== after) {
      try {
        const groups = await this.countSupportDirs(skillName)
        const delta = diffFindings(lintBody(skillName, before, groups), lintBody(skillName, after, groups))
        const parts: string[] = []
        if (delta.introduced.length > 0) parts.push('+' + delta.introduced.map(f => f.rule).join(','))
        if (delta.worsened.length > 0) parts.push('^' + delta.worsened.map(f => f.rule + ' x' + String(f.count)).join(','))
        if (parts.length > 0) healthNote = ' [health: ' + parts.join(' ') + ']'
      } catch {
        healthNote = ''
      }
    }
    try {
      await recordMutation(this.root, this.io, {
        skillName,
        action,
        ...before === null ? {} : { beforeHash: contentHash(before) },
        ...after === null ? {} : { afterHash: contentHash(after) },
        ...versions?.beforeVersion === undefined ? {} : { beforeVersion: versions.beforeVersion },
        ...versions?.afterVersion === undefined ? {} : { afterVersion: versions.afterVersion },
        summary: summary + healthNote + danglingNote,
        at,
        ...origin === undefined ? {} : { origin },
      })
    } catch {
      // Auditing is best-effort; a transient disk failure must not surface
      // after the mutation already landed.
    }
  }

  /** Recent mutation audit records (read-only inspection surface). */
  async listMutations(): Promise<MutationRecord[]> {
    return await loadMutations(this.root, this.io)
  }

  /**
   * Content versions recorded for one skill, oldest first (skill-history.ts, batch A).
   *
   * Read-only: the version seam never feeds a judgment — callers use it to LIST and to read content
   * back. A malformed or unreadable index reads as empty, and a bad name reads as empty too (the
   * caller is a human command, so "no versions" is the honest answer for a name that cannot exist).
   * @param rawName - the skill's name.
   * @returns the versions, oldest first.
   */
  async listVersions(rawName: string): Promise<SkillVersion[]> {
    const name = rawName.trim()
    if (this.badName(name) !== null) return []
    return await loadVersions(this.root, this.io, name)
  }

  /** Versions from the latest merge baseline onward; old versions stay listable via listVersions. */
  async listBaselineVersions(rawName: string): Promise<SkillVersion[]> {
    const versions = await this.listVersions(rawName)
    let start = -1
    for (let index = versions.length - 1; index >= 0; index -= 1) {
      if (versions[index]?.unitHead?.baseline === true) { start = index; break }
    }
    return start < 0 ? versions : versions.slice(start)
  }

  /**
   * One version's content, read back from the content-addressed blob store.
   * @param rawName - the skill's name.
   * @param v - the version number (see {@link SkillLibrary.listVersions}).
   * @returns the content, or null when the version does not exist, the name is unusable, or the
   *   blob cannot be read — never an empty string.
   */
  async readVersion(rawName: string, v: number): Promise<string | null> {
    const name = rawName.trim()
    if (this.badName(name) !== null) return null
    return await loadVersionContent(this.root, this.io, name, v)
  }

  /** Read an archived skill's human-readable reason, exact or stamped. */
  async readArchiveReason(rawName: string): Promise<string | null> {
    const name = rawName.trim()
    if (this.badName(name) !== null) return null
    const archiveRoot = join(this.root, '.archive')
    const exact = await this.io.readText(join(archiveRoot, name, '.archive-reason'))
    if (exact !== null) return exact.trim()
    const entries = await this.io.list(archiveRoot).catch(() => [] as string[])
    for (const entry of [...entries].reverse()) {
      if (entry !== name && !entry.startsWith(name + '-')) continue
      const marker = await this.io.readText(join(archiveRoot, entry, '.archive-name'))
      if (marker !== null && marker.trim() !== name) continue
      const reason = await this.io.readText(join(archiveRoot, entry, '.archive-reason'))
      if (reason !== null) return reason.trim()
    }
    return null
  }

  /** Read an archived skill body (SKILL.md) by its original name, exact or stamped. */
  async readArchived(rawName: string): Promise<string | null> {
    const name = rawName.trim()
    if (this.badName(name) !== null) return null
    const archiveRoot = join(this.root, '.archive')
    const exact = await this.io.readText(join(archiveRoot, name, 'SKILL.md'))
    if (exact !== null) return exact
    const entries = await this.io.list(archiveRoot).catch(() => [] as string[])
    for (const entry of [...entries].reverse()) {
      if (entry !== name && !entry.startsWith(name + '-')) continue
      const marker = await this.io.readText(join(archiveRoot, entry, '.archive-name'))
      if (marker !== null && marker.trim() !== name) continue
      const text = await this.io.readText(join(archiveRoot, entry, 'SKILL.md'))
      if (text !== null) return text
    }
    return null
  }

  /**
   * Pin or unpin a skill (`.pinned` marker). Pinned skills are protected from
   * deletion, from background-review writes, and from the lifecycle — a
   * protective mutation, so the autonomous pipeline may never call it. The
   * marker write is the only state change; content is untouched.
   */
  async setPinned(name: string, pinned: boolean, origin: WriteOrigin = this.authority.origin): Promise<SkillActionResult> {
    // A1-14 (v18): pin/unpin is a protection mutation and must be ordered with
    // the other single-file mutators on the in-process serial chain — a
    // concurrent update could otherwise pass its protection check before the
    // marker lands and rewrite a skill the user just froze.
    return await this.serial(() => this.setPinnedCore(name, pinned, origin))
  }

  private async setPinnedCore(name: string, pinned: boolean, origin: WriteOrigin): Promise<SkillActionResult> {
    const normalized = name.trim()
    // C-12 (v10 audit): the inline badName() copy is gone — every entry guard
    // reads the single source, so a limits change cannot fork the message.
    const bad = this.badName(normalized)
    if (bad) return { ok: false, message: bad }
    if (origin === 'background_review') {
      return { ok: false, message: '只有前台（用户或主智能体）可以固定或取消固定技能。' }
    }
    let durabilityWarning = ''
    const dir = this.dirOf(normalized)
    const marker = markerPath(dir, 'pinned')
    const existing = await this.io.exists(marker)
    if (pinned && existing) return { ok: true, message: `技能「${normalized}」已被固定。`, path: dir }
    if (!pinned && !existing) return { ok: true, message: `技能「${normalized}」未被固定，无需处理。`, path: dir }
    if (!await this.io.exists(join(dir, 'SKILL.md'))) {
      return { ok: false, message: `技能「${normalized}」不存在。` }
    }
    if (pinned) {
      try {
        await this.io.writeText(marker, '')
      } catch (error) {
        // P2-2 (v19): the marker landed; only the dir fsync failed. Reporting
        // a failure here made the retry say "already pinned".
        if (!isCommittedOnly(error)) throw error
        durabilityWarning = error instanceof Error ? error.message : String(error)
      }
      // v22 (LOCK-4): the SKILL.md probe above is lock-free and the marker
      // write itself holds no writer lock, so a concurrent archive moving the
      // directory in between left writeText's `mkdir(recursive)` holding the
      // old path open as a SKILL.md-less ghost (restore then refused that
      // name forever, with no log pointing at the cause). Re-check and undo:
      // if the body vanished while we wrote, the marker (and the dir it just
      // recreated) goes away with it and the caller gets a structured
      // failure instead of a silently pinned ghost.
      if (!(await this.io.exists(join(dir, 'SKILL.md')))) {
        await this.io.remove(marker).catch(() => {})
        // v23 (BR-5): remove the recreated directory only when OUR marker is
        // its LAST remaining entry — a concurrent restore's single rename can
        // land a full directory between the exists probe and this point, and
        // the recursive remove must never take it.
        // v29 SK-06: routed through the shared `cleanupGhostDir` (probing the
        // SKILL.md path) so a stale `.lock` left by a failed lock release no
        // longer defeats the removal and the rule has exactly one owner.
        await this.cleanupGhostDir(join(dir, 'SKILL.md'))
        return { ok: false, message: `固定过程中技能「${normalized}」被并发归档；残留标记已移除：等搬运完成后重试。` }
      }
    } else {
      await this.io.remove(marker)
    }
    await this.audit(normalized, pinned ? 'pin' : 'unpin', null, null, pinned ? 'pinned' : 'unpinned')
    return {
      ok: true,
      message: `${pinned
        ? `技能 "${normalized}" 已固定：免受删除、后台复核与生命周期影响。`
        : `技能 "${normalized}" 已取消固定。`}${durabilityWarning === '' ? '' : ` （警告：写入已落盘，但目录 fsync 失败 —— 持久性未确认：${durabilityWarning})`}`,
      path: dir,
    }
  }

  async create(
    name: string,
    content: string,
    origin: WriteOrigin = this.authority.origin,
    options: { unitId?: string; unitHead?: UnitHead; managed?: boolean } = {},
  ): Promise<SkillActionResult> {
    await this.ensureRecovered()
    const normalized = name.trim()
    // P2-3 (v11): the exists-probe → write window runs under the in-process
    // serialize queue (F-208 discipline, like update/patch) — two concurrent
    // create calls for one name used to both pass exists() and double-write
    // (double audit, double mutation event).
    return await this.serial(() => this.withMutationLock(() => this.createCore(normalized, content, origin, options)))
  }

  private async createCore(
    normalized: string,
    content: string,
    origin: WriteOrigin,
    options: { unitId?: string; unitHead?: UnitHead; managed?: boolean } = {},
  ): Promise<SkillActionResult> {
    // C-12 (v10 audit): the inline badName() copy is gone (see setPinned).
    const bad = this.badName(normalized)
    if (bad) return { ok: false, message: bad }
    const validation = validateFrontmatter(content, normalized, this.limits)
    if (validation) {
      if (exceedsContentLimit(content, this.limits.maxSkillContentChars)) await this.recordHardCapHit(normalized, content.length, 'create')
      return { ok: false, message: validation }
    }
    // 0.3.11: frontmatter normalization happens at the write point — the
    // platform catalog parses strict YAML, so unquoted plain scalars carrying
    // `: ` (etc.) would silently make the skill invisible to the platform.
    const norm = normalizeFrontmatter(content)
    if (norm.issues.length > 0) return { ok: false, message: `技能「${normalized}」的 frontmatter 无法自动修复：${norm.issues[0]}：请用双引号包住取值后重试。` }
    const finalContent = norm.changed ? norm.content : content
    if (norm.changed) {
      const revalidated = validateFrontmatter(finalContent, normalized, this.limits)
      if (revalidated) return { ok: false, message: revalidated }
    }
    const threat = this.contentThreatBlock(finalContent)
    if (threat) return { ok: false, message: threat }
    const dir = this.dirOf(normalized)
    if (await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `技能「${normalized}」已存在。` }
    // v21 (D-6): NTFS and macOS default filesystems match names case-
    // insensitively while the skill namespace is lowercase-only — a hand-
    // maintained tree carrying `My-Tool/` made create('my-tool') diverge
    // across platforms (exists-refusal on win32, silently created beside it
    // on POSIX, vanishing after a git/WSL round-trip). Probe the listing for
    // a case-variant and refuse with the variant named, so the refusal reads
    // the same everywhere. Read paths stay platform-native (fail-closed).
    // v43 audit (FLOW3-2): a FAILED listing must not read as "no case-variant
    // exists". The catch-all folded every error into an empty list, so a
    // transient list failure skipped this guard on POSIX and created `my-tool/`
    // beside `My-Tool/` — the very input win32 refuses — while the probe further
    // down this file already draws the opposite line (its comment: a failed
    // enumeration must not mask the error). Fail closed.
    let rootEntries: readonly string[]
    try {
      rootEntries = await this.io.list(this.root)
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        message: `无法检查技能「${normalized}」是否与大小写变体冲突：列出 ${this.root} 失败（${cause}）。拒绝创建 —— 仅大小写不同的第二个目录在跨平台时无法撤销。`,
      }
    }
    for (const entry of rootEntries) {
      if (typeof entry === 'string' && entry !== normalized && entry.toLowerCase() === normalized.toLowerCase()) {
        return { ok: false, message: `技能「${normalized}」与已存在的大小写变体目录「${entry}」冲突（技能名只允许小写）：请重命名其中一个。` }
      }
    }
    // C-15: a pre-existing directory carrying a protection marker is
    // refused — the same writeProtection() verdict update/patch apply — so
    // create() can no longer drop a SKILL.md into a bundled/hub-installed
    // (or, for the review channel, pinned) tree it does not own.
    const protection = await this.writeProtection(normalized, origin)
    if (protection) return { ok: false, message: `技能「${normalized}」受保护（${protection}）。` }
    // F-337: hash the bytes that actually land on disk (write uses
    // trimEnd()+'\n'), so the audit afterHash is replay-identical to the file.
    const onDisk = finalContent.trimEnd() + '\n'
    const createPath = join(dir, 'SKILL.md')
    // P3 (v17): the already-exists refusal moves INSIDE the cross-process
    // transact — the lock-free probe above could be raced by a concurrent
    // create on another instance/process, and the later write silently
    // overwrote the winner's bytes (double audit, double event). In-lock
    // re-check: current bytes present -> structured refusal, nothing written.
    const unit = new MutationUnit({
      io: this.io,
      limits: { maxSkillFileBytes: Number.MAX_SAFE_INTEGER, maxSkillContentChars: Number.MAX_SAFE_INTEGER },
      lock: { acquire: async () => ({ release: async () => {} }) },
      journal: unitJournalPort(this.io, dirname(this.root)),
      snapshots: unitSnapshotPort(this.io, dirname(this.root)),
      transactGuard: false,
      hooks: {
        undone: async () => {
          await this.io.remove(markerPath(dir, 'hermes-managed')).catch(() => {})
        },
      },
    })
    const result = await unit.apply({
      name: normalized,
      origin,
      roots: [{ name: normalized, protection: 'write' }],
      rootDirs: { [normalized]: dir },
      ops: [{ kind: 'write', target: createPath, content: onDisk, expected: null, skill: normalized }],
      auditAction: 'create',
      auditSummary: 'created',
      eventAction: 'create',
      cleanupPaths: [markerPath(dir, 'hermes-managed')],
      ...(options.unitId === undefined ? {} : { unitId: options.unitId }),
    })
    if (!result.ok) {
      if (result.errors.some(error => error.code === 'cas-drift' || error.message.includes('concurrent modification'))) return { ok: false, message: `技能「${normalized}」已存在。` }
      return { ok: false, message: result.errors.map(error => error.message).join('；') }
    }
    const createDurabilityWarning = result.warnings === undefined ? '' : result.warnings.join('；')
    // Any non-foreground writer (review channel OR delegated subagent) is an
    // agent-authored skill: mark it managed so the lifecycle owns it.
    // v22 (LOCK-4): the marker lands only while the body we just wrote is
    // still on disk — a concurrent archive moving the fresh directory away
    // would otherwise let writeText's mkdir resurrect the old path as a
    // SKILL.md-less ghost (same compensating cleanup as setPinnedCore).
    // R3 (audit of A6): the marker warning keeps its OWN variable and its own
    // sentence — the former fold into createDurabilityWarning re-framed "the
    // marker never landed" inside the fsync/durability wrapper, producing a
    // self-contradicting operator-facing message.
    let markerWarning = ''
    if (origin !== 'foreground' || options.managed === true) {
      // v29 SK-05: the marker write gets the same committed-only tolerance as
      // every other write in this file (A1-15) — a post-rename dir-fsync
      // failure means the MARKER landed; rejecting the create as a plain
      // failure made the model retry into "already exists" for a skill that
      // IS on disk and managed.
      try {
        await this.io.writeText(markerPath(dir, 'hermes-managed'), '')
      } catch (error) {
        // A6 (audit P2-11): the body HAS landed at this point, so a failed
        // marker write must not rethrow — the former rethrow skipped the
        // audit/event accounting AND made every retry hit "already exists"
        // with no repair path, leaving the skill permanently un-managed.
        // Both failure kinds now ride the normal success path: a
        // committed-only failure means the marker LANDED (durability
        // unconfirmed); any other failure means the skill stays un-managed,
        // which the result text says out loud.
        if (isCommittedOnly(error)) {
          markerWarning = `hermes-managed 标记已落盘，但其目录 fsync 失败 —— 持久性未确认：${error instanceof Error ? error.message : String(error)}`
        } else {
          markerWarning = `hermes-managed marker write failed (${error instanceof Error ? error.message : String(error)}); the skill landed but is NOT lifecycle-managed — recreate or pin it manually`
        }
      }
      if (!(await this.io.exists(createPath))) {
        await this.io.remove(markerPath(dir, 'hermes-managed')).catch(() => {})
        // v23 (BR-5) + v29 SK-06: same compensating cleanup as setPinnedCore —
        // routed through the shared `cleanupGhostDir` so a stale lock file (a
        // failed lock release) no longer defeats the empty-dir removal.
        await this.cleanupGhostDir(createPath)
        return { ok: false, message: `创建过程中技能「${normalized}」被并发归档；残留标记已移除：等搬运完成后重试一次。` }
      }
    }
    await this.audit(normalized, 'create', null, onDisk, 'created', undefined, result.unitId, options.unitHead)
    this.notifyMutation({ action: 'create', name: normalized, skillDir: dir })
    // Both warnings ride the normal success path (audit/event included) — a
    // durability warning must never skip the accounting.
    const warnings = [
      createDurabilityWarning !== '' ? `写入已落盘，但目录 fsync 失败 —— 持久性未确认：${createDurabilityWarning}` : '',
      markerWarning,
    ].filter(warning => warning !== '')
    return {
      ok: true,
      message: `已创建技能「${normalized}」。${warnings.length === 0 ? '' : ` （警告：${warnings.join('；')}）`}`,
      path: dir,
      ...(norm.changed ? { normalizedFrontmatterFields: norm.fields } : {}),
    }
  }

  async update(
    rawName: string,
    content: string,
    origin: WriteOrigin = this.authority.origin,
    anchor?: WriteAnchor,
  ): Promise<SkillActionResult> {
    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()
    await this.ensureRecovered()
    // F-208: the whole read→validate→write runs under the in-process serialize
    // queue so two concurrent updates on one skill never interleave.
    return await this.serial(() => this.updateCore(name, content, origin, anchor))
  }

  private async updateCore(name: string, content: string, origin: WriteOrigin, anchor?: WriteAnchor): Promise<SkillActionResult> {
    // P3 (v15): guard BEFORE dirOf — same order as patchCore, so no path
    // string is ever built from an unvalidated name (dirOf does not touch IO,
    // so this is consistency hygiene, not a reachable gap).
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    const path = join(dir, 'SKILL.md')
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `技能「${name}」受保护（${protection}）。` }
    // S1.2: a lock-free read feeds only the shrink exemption below; the commit
    // still runs inside the write transaction with its own locked read.
    // N36: three-state. "Could not read" answers `null` like "no file yet", which is the CONSERVATIVE
    // direction here (an already-over-limit body loses the repair exemption and is refused, never
    // accepted), and the reason is named.
    const limitProbe = await probeText(this.io, path)
    if (isUnknown(limitProbe)) console.warn(`skill-store: could not re-read ${path} for the shrink exemption (${limitProbe.reason}); validating without it — an over-limit repair is refused, not accepted`)
    const currentForLimit = isPresent(limitProbe) ? limitProbe.value : null
    const validation = validateFrontmatter(content, name, this.limits, currentForLimit)
    if (validation) {
      if (exceedsContentLimit(content, this.limits.maxSkillContentChars)) await this.recordHardCapHit(name, content.length, 'update')
      return { ok: false, message: validation }
    }
    // 0.3.11: normalize at the write point (see create) — same reasoning.
    const norm = normalizeFrontmatter(content)
    if (norm.issues.length > 0) return { ok: false, message: `技能「${name}」的 frontmatter 无法自动修复：${norm.issues[0]}：请用双引号包住取值后重试。` }
    const finalContent = norm.changed ? norm.content : content
    if (norm.changed) {
      const revalidated = validateFrontmatter(finalContent, name, this.limits, currentForLimit)
      if (revalidated) return { ok: false, message: revalidated }
    }
    const threat = this.contentThreatBlock(finalContent)
    if (threat) return { ok: false, message: threat }
    let current: string | null
    try {
      current = await this.io.readText(path)
    } catch (error) {
      return anchor !== undefined ? anchorUnverifiable(name, null) : unreadableTarget(name, error)
    }
    const verdict = anchorVerdict(anchor, current)
    if (verdict !== 'match') return anchorRefusal(name, verdict)
    if (current === null) {
      await this.cleanupGhostDir(path)
      return { ok: false, message: `技能「${name}」不存在。` }
    }
    if (finalContent.trimEnd() === current.trimEnd()) {
      return { ok: true, message: `技能「${name}」未变更：提供的内容与当前文件一致，未写入。`, noop: true, path: dir }
    }
    const onDisk = finalContent.trimEnd() + '\n'
    const unit = new MutationUnit({
      io: this.io,
      limits: { maxSkillFileBytes: Number.MAX_SAFE_INTEGER, maxSkillContentChars: Number.MAX_SAFE_INTEGER },
      lock: fileMutationLock(this.io, this.root),
      journal: unitJournalPort(this.io, dirname(this.root)),
      snapshots: unitSnapshotPort(this.io, dirname(this.root)),
      ...(this.transact === undefined ? {} : { transact: this.transact }),
      hooks: {
        committed: async event => {
          const op = event.ops[0]
          if (op === undefined) return
          await this.audit(name, 'update', op.before, op.after, 'updated', undefined, event.unitId, { sources: [{ skill: name }] }, origin)
          this.notifyMutation({ action: 'update', name, skillDir: dir })
        },
      },
      validateWrite: op => op.kind === 'write' ? this.contentThreatBlock(op.content) : null,
    })
    const result = await unit.apply({
      name,
      origin,
      roots: [{ name, protection: 'write' }],
      rootDirs: { [name]: dir },
      ops: [{ kind: 'write', target: path, content: onDisk, expected: current, skill: name }],
      auditAction: 'update',
      auditSummary: 'updated',
      eventAction: 'update',
    })
    if (!result.ok) {
      const messages = result.errors.map(error => error.message)
      if (messages.some(message => message.includes('mutation-lock-transact-not-run') || message.includes('did not invoke the task'))) return { ok: false, message: '内部错误：写事务没有调用任务；未执行任何写入' }
      return { ok: false, message: messages.join('；') }
    }
    const warning = result.warnings === undefined || result.warnings.length === 0 ? '' : ` （警告：写入已落盘，但目录 fsync 失败 —— 持久性未确认：${result.warnings.join('；')})`
    const retention = contentRetentionFeedback({ name, action: 'update', before: current, after: onDisk })
    return { ok: true, message: `技能「${name}」已更新。${warning}${retention === null ? '' : '\n' + retention}`, path: dir, ...(norm.changed ? { normalizedFrontmatterFields: norm.fields } : {}) }
  }

  async patch(rawName: string, oldString: string, newString: string, filePath = '', replaceAll = false, origin: WriteOrigin = this.authority.origin): Promise<SkillActionResult> {
    await this.ensureRecovered()
    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()
    // F-208: the whole read→patch→write runs under the in-process serialize
    // queue so two concurrent patches on one skill never interleave.
    return await this.serial(() => this.patchCore(name, oldString, newString, filePath, replaceAll, origin))
  }

  private async patchCore(
    name: string,
    oldString: string,
    newString: string,
    filePath: string,
    replaceAll: boolean,
    origin: WriteOrigin,
  ): Promise<SkillActionResult> {
    // P1-1 (v14): patch was the ONE path-building mutator without the name
    // guard — `name = '../outside'` plus a `file_path` escaped the skills root
    // and rewrote an existing support file there (the SKILL.md branch was
    // saved only by the frontmatter name equality check, the support-file
    // branch had no such second line of defence).
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    const skillMd = join(dir, 'SKILL.md')
    if (!await this.io.exists(skillMd)) return { ok: false, message: `技能「${name}」不存在。` }
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `技能「${name}」受保护（${protection}）。` }

    let target = skillMd
    let patchLabel = 'SKILL.md'
    if (filePath) {
      const validation = validateSupportPath(filePath)
      if (validation) return { ok: false, message: validation }
      target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
      patchLabel = filePath
    }
    const compute = (current: string | null): SingleWriteOutcome => {
      const md = current
      if (md === null) return { result: { ok: false, message: `文件不存在：${patchLabel}` }, write: null }

      // V6-17 (0.3.37): the fuzzy scan is O(n·m) with no input bound (a
      // model-supplied 20k anchor over a 20k file measured ~6s with the event
      // loop blocked). The exact `includes` path served an exact hit already;
      // a NON-exact anchor past the budget is refused with an honest message.
      if (!md.includes(oldString) && (oldString.length > FUZZY_MAX_PATTERN_CHARS || md.length * oldString.length > FUZZY_MAX_WORK)) {
        return { result: { ok: false, message: `old_string too large for fuzzy match (${oldString.length} chars in ${patchLabel}); use update for a full rewrite or a narrower anchor.` }, write: null }
      }
      // P3-30 (v14): an empty or whitespace-only anchor is refused by the
      // fuzzy boundary, but the caller used to report it as "Could not find
      // old_string" — indistinguishable from a genuine miss. Name the real
      // reason so the model retries with an anchor instead of rewriting.
      if (oldString === '' || trimPatternBoundaries(oldString) === '') {
        return { result: { ok: false, message: `old_string is empty (or whitespace-only) — a patch of "${name}/${patchLabel}" needs an anchor; use update for a full rewrite.` }, write: null }
      }
      const patched = fuzzyPatch(md, oldString, newString, replaceAll)
      // `null` means "no match" or (V7-11) the replaceAll loop exceeded the
      // cumulative fuzzy budget; an empty string is a legitimate replacement.
      if (patched === null) return { result: { ok: false, message: `在「${name}/${patchLabel}」里找不到 old_string（或 replaceAll 的模糊匹配预算已用尽）。整篇重写请改用 update。` }, write: null }
      // V27 G5.1: a first-occurrence-only patch is the silent case the tool
      // description used to omit — report how many anchors the file carries, so
      // a multi-site edit is never half-applied without the model noticing.
      const anchorCount = oldString === '' ? 0 : md.split(oldString).length - 1
      const firstOnly = !replaceAll && anchorCount > 1
      const patchNote = firstOnly ? ` Replaced the FIRST of ${anchorCount} occurrences; pass replace_all=true to change every one.` : ''
      let writeContent = patched
      let normalizedFields: string[] | undefined
      if (target === skillMd) {
        const validation = validateFrontmatter(patched, name, this.limits, md)
        if (validation) return { result: { ok: false, message: `补丁被拒绝：${validation}` }, write: null }
        // 0.3.11: normalize at the write point (see create) — a patch may edit
        // the frontmatter directly.
        const norm = normalizeFrontmatter(patched)
        if (norm.issues.length > 0) return { result: { ok: false, message: `补丁被拒绝：frontmatter 无法自动修复（${norm.issues[0]}）。` }, write: null }
        if (norm.changed) {
          writeContent = norm.content
          normalizedFields = norm.fields
          const revalidated = validateFrontmatter(writeContent, name, this.limits, md)
          if (revalidated) return { result: { ok: false, message: `补丁被拒绝：${revalidated}` }, write: null }
        }
      }
      if (Buffer.byteLength(writeContent, 'utf8') > this.limits.maxSkillFileBytes && target !== skillMd) {
        return { result: { ok: false, message: `修补后的文件超过 ${this.limits.maxSkillFileBytes} 字节。` }, write: null }
      }
      const overLimit = exceedsContentLimit(writeContent, this.limits.maxSkillContentChars)
      const repairing = shrinksOverLimit(writeContent, md, this.limits.maxSkillContentChars)
      if (overLimit && target === skillMd && !repairing) {
        return { result: { ok: false, message: `修补后的内容超过 ${this.limits.maxSkillContentChars} 个字符。${CONTENT_SPLIT_HINT}` }, write: null, hardCapHit: { bodyChars: writeContent.length, supportFiles: null } }
      }
      // V4: the same cap on a SUPPORT file. Report mode writes with an advisory;
      // enforce refuses unless the patch makes an already-over file smaller.
      const supportOverCap = overLimit && target !== skillMd && !repairing
      const capAdvisory = supportOverCap
        ? ` Warning: ${writeContent.length} characters is over the ${this.limits.maxSkillContentChars}-character cap upstream applies to every file; plan a split.`
        : ''
      if (supportOverCap && this.supportFileCharPolicy() === 'enforce') {
        return { result: { ok: false, message: `修补后的文件内容超过 ${this.limits.maxSkillContentChars} 个字符。${CONTENT_SPLIT_HINT}` }, write: null, hardCapHit: { bodyChars: writeContent.length, supportFiles: 1 } }
      }
      const threat = this.contentThreatBlock(writeContent)
      if (threat) return { result: { ok: false, message: threat }, write: null }
      // 0.3.18 (E-68): old_string === replacement reaches fuzzyPatch's exact
      // path and yields patched === md. Previously the file was rewritten, the
      // patch counter bumped and the whole catalog invalidated for zero change.
      // Byte-identical-to-write means a true no-op: skip write/audit/notify.
      // F-318 (①): normalize BOTH sides — a legacy file without a trailing
      // newline (or with multiple trailing newlines) used to fail this check for
      // an identical replacement, rewriting + auditing + invalidating the catalog
      // for zero change.
      if (writeContent.trimEnd() === md.trimEnd()) {
        return { result: { ok: true, message: `技能「${name}」未变更：old_string 与替换内容相同（${patchLabel}），未写入。`, noop: true, path: dir }, write: null }
      }
      // F-337: hash the bytes that actually land on disk (write uses
      // trimEnd()+'\n'), so the audit afterHash is replay-identical to the file.
      const onDisk = writeContent.trimEnd() + '\n'
      return {
        result: { ok: true, message: `技能「${name}」已修补（${patchLabel}）。${patchNote}${capAdvisory}`, path: dir, ...(normalizedFields ? { normalizedFrontmatterFields: normalizedFields } : {}) },
        write: onDisk,
        audit: { skillName: name, action: 'patch', before: md, after: onDisk, summary: `patched ${patchLabel}` },
        event: { action: 'patch', name, skillDir: dir },
      }
    }
    let current: string | null
    try {
      current = await this.io.readText(target)
    } catch (error) {
      return unreadableTarget(name + '/' + patchLabel, error)
    }
    if (current === null) {
      await this.cleanupGhostDir(target)
      return { ok: false, message: `文件不存在：${patchLabel}` }
    }
    const outcome = compute(current)
    if (outcome.write === null) {
      if (outcome.hardCapHit !== undefined) await this.recordHardCapHit(name, outcome.hardCapHit.bodyChars, 'patch', outcome.hardCapHit.supportFiles)
      return outcome.result
    }
    const onDisk = outcome.write
    const unit = new MutationUnit({
      io: this.io,
      limits: { maxSkillFileBytes: Number.MAX_SAFE_INTEGER, maxSkillContentChars: Number.MAX_SAFE_INTEGER },
      lock: fileMutationLock(this.io, this.root),
      journal: unitJournalPort(this.io, dirname(this.root)),
      snapshots: unitSnapshotPort(this.io, dirname(this.root)),
      ...(this.transact === undefined ? {} : { transact: this.transact }),
      hooks: {
        committed: async event => {
          await this.audit(name, 'patch', outcome.audit?.before ?? current, event.ops[0]?.after ?? onDisk, outcome.audit?.summary ?? `patched ${patchLabel}`, filePath === '' ? undefined : filePath, event.unitId, { sources: [{ skill: name }] }, origin)
          this.notifyMutation({ action: 'patch', name, skillDir: dir })
        },
      },
      validateWrite: op => op.kind === 'write' ? this.contentThreatBlock(op.content) : null,
    })
    const result = await unit.apply({
      name,
      origin,
      roots: [{ name, protection: 'write' }],
      rootDirs: { [name]: dir },
      ops: [{ kind: 'write', target, content: onDisk, expected: current, skill: name }],
      auditAction: 'patch',
      auditSummary: outcome.audit?.summary ?? `patched ${patchLabel}`,
      eventAction: 'patch',
    })
    if (!result.ok) {
      const messages = result.errors.map(error => error.message)
      if (messages.some(message => message.includes('mutation-lock-transact-not-run') || message.includes('did not invoke the task'))) return { ok: false, message: '内部错误：写事务没有调用任务；未执行任何写入' }
      return { ok: false, message: messages.join('；') }
    }
    const warning = result.warnings === undefined || result.warnings.length === 0 ? '' : ` （警告：写入已落盘，但目录 fsync 失败 —— 持久性未确认：${result.warnings.join('；')})`
    const retention = contentRetentionFeedback({ name, action: 'patch', before: current, after: onDisk })
    return { ...outcome.result, message: `${outcome.result.message}${warning}${retention === null ? '' : '\n' + retention}` }
  }

  /**
   * P2-9 (v15): the destructive directory move shared by archive and
   * restoreFromArchive — rename first, copy+remove fallback when the backend
   * cannot rename across media (V5-35), with the E-14 rollback when the
   * fallback's source removal fails. Returns a failure MESSAGE on a failed
   * move (caller wraps into a structured result) or undefined on success.
   */
  private async moveDir(dir: string, dest: string): Promise<string | undefined> {
    try {
      await this.io.rename(dir, dest)
      return undefined
    } catch {
      // P2 (v17): rename failing because the DESTINATION appeared mid-move
      // (concurrent create/restore on the same name) must NOT fall through to
      // the copy fallback — `cp force` merges trees, silently overwriting the
      // concurrent writer's bytes and reporting success. Refuse instead; the
      // fallback is only for genuine cross-media rename failures.
      if (await this.io.exists(dest)) {
        return 'the destination appeared mid-move (concurrent create or restore); refusing to merge — inspect both trees'
      }
      // Some IO providers cannot rename across media. Copy the whole tree
      // first so support files are never lost during archival fallback.
      // V5-35 (0.3.32): a concurrent archiver may have already moved the
      // source (or the rename failed for another transcient reason) — surface
      // the fallback failure as a result instead of a raw ENOENT.
      try {
        await this.io.copy(dir, dest)
      } catch (copyError) {
        return `the move fell back to copy but failed (${copyError instanceof Error ? copyError.message : String(copyError)}); the tree stays where it is`
      }
      try {
        await this.io.remove(dir)
        return undefined
      } catch (error) {
        // 0.3.16 (E-14): a failed remove left the tree in BOTH locations, and
        // the source was never counted as moved so a rollback loop would not
        // clean it. Undo the copy we just made; if even that fails, say so
        // instead of rethrowing the remove error.
        const reason = error instanceof Error ? error.message : String(error)
        try {
          await this.io.remove(dest)
          return `复制成功，但源目录删不掉（${reason}）；已回滚复制出的目录树`
        } catch {
          return `复制成功，但源目录删不掉（${reason}），且复制出的目录树也无法回滚 —— 该目录树现在同时存在于两处；请手动清理`
        }
      }
    }
  }

  /**
   * P2 (v16): the write-lock probe for the DESTRUCTIVE MOVERS (archive /
   * restoreFromArchive). A byte-writer mid-flight is the ghost-generator —
   * after the move its transact commit re-creates `<dir>/…` (mkdir
   * recursive) and the tree ends half-archived.
   * G2 S4: the writer-lock probe that used to answer this question is retired — writes go through
   * the provider's versioned writes, so a writer that raced the move fails its own write loudly
   * instead of landing on a moved-away path. What REMAINS load-bearing here is the fail-closed
   * listing rule, which is about the filesystem misbehaving rather than about writers.
   */
  private async supportDirsUnlistable(dir: string): Promise<boolean> {
    for (const supportDir of SUPPORT_DIRS) {
      try {
        await this.io.list(join(dir, supportDir))
      } catch {
        // P3 (v17), kept: fail-CLOSED — a real list failure (EACCES/EIO; a missing dir reads as []
        // per the seam contract) must refuse the move, not read as "nothing there".
        return true
      }
    }
    return false
  }

  /** A1-4 (v18): a manifest-declared name is copied with `join(root, name)`;
   * only a single, non-traversing path component is safe. Dotfiles
   * (`.usage.json`) stay allowed — sidecars are legitimately dot-prefixed.
   * P2-4 (v19): a non-string entry (`skills: [123]`) is refused structurally
   * instead of throwing `name.includes is not a function`. */
  private safeSnapshotEntryName(name: unknown): boolean {
    if (typeof name !== 'string') return false
    return name !== '' && name !== '.' && name !== '..'
      && !name.includes('/') && !name.includes('\\')
      && basename(name) === name
  }

  /** Mark merge-absorbed sources archived in the usage sidecar (FR-DATA-07). */
  private async foldArchivedUsage(sources: readonly string[], at: string): Promise<void> {
    try {
      await mutateUsage(this.root, this.io, map => {
        for (const name of sources) {
          const record = getRecord(map, name)
          record.state = 'archived'
          record.archived_at = at
        }
      })
    } catch { /* lifecycle telemetry is best-effort; the archive already landed */ }
  }

  async archive(rawName: string, options: ArchiveOptions = {}, origin: WriteOrigin = this.authority.origin): Promise<SkillActionResult> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    const badName = this.badName(name, { allowReserved: true })
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    // C-14: a 0-byte SKILL.md is "present but corrupt" — the tree is
    // still archivable (protection checks and the audit do not need body
    // bytes; the audit hashes the empty before-string). Only a genuinely
    // MISSING file reads as "not found".
    if (md === null) return { ok: false, message: `技能「${name}」不存在。` }
    // C-13 (v10 audit): the redundant ternary is gone — deleteProtection now
    // accepts an explicit `undefined` allowBundled, so the options object
    // passes through verbatim.
    const protection = await this.deleteProtection(name, options)
    if (protection) {
      return {
        ok: false,
        message: protection === 'pinned'
          ? `Skill "${name}" is pinned and cannot be archived. Remove the \`.pinned\` marker in its directory, then retry.`
          : `技能「${name}」受保护（${protection}）。`,
      }
    }
    if (options.absorbedInto) {
      // 0.3.18 (E-69): `delete X absorbed_into=X` used to pass the existence
      // check (it read the archived skill's own still-present file) and
      // archive X "into itself". Refuse the self-absorption up front.
      if (options.absorbedInto.trim() === name) {
        return { ok: false, message: 'absorbed_into 不能是正在归档的技能本身（不能吸收到自己）。' }
      }
      // P2-8 (v15): absorbedInto reaches dirOf below — the same guard every
      // other path-building entry applies must hold here too, or
      // `absorbed_into: '../x'` builds a probe path outside the skills root
      // and the raw value lands in .archive-reason / the audit summary.
      const intoBad = this.badName(options.absorbedInto.trim())
      if (intoBad) return { ok: false, message: `absorbed_into: ${intoBad}` }
      const target = await this.io.readText(join(this.dirOf(options.absorbedInto), 'SKILL.md'))
      if (!target) return { ok: false, message: `absorbed_into="${options.absorbedInto}" does not exist.` }
    }
    const archiveRoot = join(this.root, '.archive')
    let dest = join(archiveRoot, name.trim())
    if (await this.io.exists(dest)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      dest = join(archiveRoot, `${name.trim()}-${stamp}`)
      // Stamp collisions within one second (N-6): two re-archives of the same
      // name in the same second used to share one stamped destination and
      // overwrite each other. Keep probing with a random suffix, mirroring the
      // snapshotAll() collision guard.
      while (await this.io.exists(dest)) {
        dest = join(archiveRoot, `${name.trim()}-${stamp}-${Math.random().toString(36).slice(2, 8)}`)
      }
    }
    // Symlink guard (G7): moving a symlinked tree would relocate the link, not
    // the content it points at — refuse before the rename instead.
    if (this.io.isSymlink) {
      const link = await this.io.isSymlink(dir)
      if (link === true) return { ok: false, message: `技能「${name}」是符号链接；拒绝归档。` }
    }
    // G2 S4: refuse when a support directory cannot be LISTED (fail-closed — see
    // `supportDirsUnlistable`). The writer probe that used to stand here is retired: writes are
    // versioned, so a writer that raced this move fails its own write instead of landing on a
    // moved-away path.
    if (await this.supportDirsUnlistable(dir)) {
      return { ok: false, message: `无法检查技能「${name}」是否有写入方（有一个支撑目录列不出来）：请重试归档。` }
    }
    // OPT-06 (2026-09): pin/protection RE-CHECK at the commit point. The
    // protection probe near the top runs several awaits before the move; a
    // `.pinned` marker landing in that window used to be archived anyway
    // (the same race A1-14 closed for update by holding the serial chain —
    // archive cannot take that chain because consolidate calls it from
    // inside one). This re-check shrinks the window to the single gap
    // before moveDir; fully closing it would need check-under-lock semantics
    // in the io.ts mover protocol, which is deliberately out of scope here.
    const commitProtection = await this.deleteProtection(name, options)
    if (commitProtection) {
      return {
        ok: false,
        message: commitProtection === 'pinned'
          ? `Skill "${name}" is pinned and cannot be archived. Remove the \`.pinned\` marker in its directory, then retry.`
          : `技能「${name}」受保护（${commitProtection}）。`,
      }
    }
    const moveFailure = await this.moveDir(dir, dest)
    if (moveFailure !== undefined) return { ok: false, message: `技能「${name}」归档失败：${moveFailure}。` }
    const reason = options.reason ?? (options.absorbedInto ? `Consolidated into ${options.absorbedInto}` : 'Archived by self-evolution curator')
    // P2-9 (v14): the move already landed, so a failed metadata write must NOT
    // abort the archive — the caller (consolidate) would then report a rollback
    // it cannot perform while the tree stays archived, and audit/notify below
    // would be skipped entirely. The reason file is metadata; best-effort like
    // `audit()`.
    try {
      await this.io.writeText(join(dest, '.archive-reason'), `${new Date().toISOString()}: ${reason}\n`)
    } catch {
      // The archive itself succeeded; only the human-readable reason is missing.
    }
    // V27 G8.4: record the owning skill name next to the archived tree. The
    // restore match used to depend on the archived SKILL.md's frontmatter, so an
    // entry whose SKILL.md is 0 bytes (or whose frontmatter no longer parses)
    // was unrecoverable by name even though its directory says which skill it
    // was. Best-effort like the reason marker: the archive is already complete.
    try {
      await this.io.writeText(join(dest, '.archive-name'), `${name}\n`)
    } catch {
      // Same posture as .archive-reason: metadata only, never abort the archive.
    }
    await this.audit(name, 'archive', md, null, reason, undefined, options.unitId, options.unitHead, origin)
    this.notifyMutation({ action: 'archive', name, archivedPath: dest })
    return { ok: true, message: `技能「${name}」已归档到 .archive。`, path: dest }
  }

  /**
   * Commit one merge plan as a single multi-skill transaction.
   *
   * Existing target: archive every source first, then write the target through the
   * tree-change kernel. Create target: create the target with its final body first
   * (so absorbedInto can see it), then archive sources and write support files.
   * Every failure rolls back what already landed; a rollback failure names the
   * unrestored skills instead of claiming success.
   */
  async commitMerge(plan: CommitMergePlan): Promise<CommitMergeResult> {
    const target = plan.target.trim()
    const sources = [...new Set(plan.sources.map(name => name.trim()))].filter(name => name !== target)
    if (sources.length === 0) return { ok: false, message: '合并至少需要一个互不相同的来源技能。' }
    for (const name of [target, ...sources]) {
      const bad = this.badName(name)
      if (bad) return { ok: false, message: bad }
    }
    if (PROTECTED_BUILTIN_SKILLS.has(target)) return { ok: false, message: `目标技能「${target}」是受保护的内置技能。` }
    const protectedSource = sources.find(name => PROTECTED_BUILTIN_SKILLS.has(name))
    if (protectedSource !== undefined) return { ok: false, message: `来源技能「${protectedSource}」是受保护的内置技能。` }
    const limits = plan.limits ?? this.limits
    return await this.serial(async (): Promise<CommitMergeResult> => {
      const dir = this.dirOf(target)
      const targetPath = join(dir, 'SKILL.md')
      if (!plan.targetExists && await this.io.exists(dir)) {
        return { ok: false, message: `目标目录「${target}」已存在但不是技能；拒绝把 SKILL.md 写进同名目录。` }
      }
      const currentTarget = await this.io.readText(targetPath)
      if (plan.targetExists !== (currentTarget !== null)) {
        return { ok: false, message: plan.targetExists ? `目标技能「${target}」不存在。` : `目标技能「${target}」已存在。` }
      }
      if (currentTarget !== plan.expectedTargetBody) {
        return { ok: false, message: `目标技能「${target}」在计划之后被改过；拒绝提交（未写入任何内容）。` }
      }
      if (plan.targetExists && !(await this.isManaged(target))) {
        return { ok: false, message: `目标技能「${target}」不是 family-managed；拒绝提交。` }
      }
      if (await this.io.exists(markerPath(dir, 'pinned'))) {
        return { ok: false, message: `目标技能「${target}」已被固定；拒绝提交。` }
      }
      const targetProtection = await this.writeProtection(target, plan.origin)
      if (targetProtection) return { ok: false, message: `技能「${target}」受保护（${targetProtection}）。` }
      const expectedSources = new Map(plan.expectedSourceBodies.map(entry => [entry.name.trim(), entry.body]))
      const sourceBodies = new Map<string, string>()
      for (const source of sources) {
        const protection = await this.deleteProtection(source)
        if (protection) return { ok: false, message: `技能「${source}」受保护（${protection}）。` }
        const body = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
        if (body === null) return { ok: false, message: `来源技能「${source}」不存在。` }
        const expected = expectedSources.get(source)
        if (expected === undefined) return { ok: false, message: `来源技能「${source}」缺少计划字节；拒绝提交。` }
        if (body !== expected) return { ok: false, message: `来源技能「${source}」在计划之后被改过；拒绝提交（未写入任何内容）。` }
        sourceBodies.set(source, body)
      }
      // Decision-time CAS (FR-EXEC-12/GAP-CAND-02): the body compare above only covers
      // SKILL.md; a changed support file (or a changed target body recorded with different
      // formatting) would still slip through. Re-hash the LIVE tree with the same canonical
      // fingerprint the decision recorded and refuse before the first write.
      if (plan.targetRevision !== undefined) {
        const liveTargetRevision = await this.revisionAnchor(target)
        if (!sameRevisionAnchor(plan.targetRevision, liveTargetRevision)) {
          return { ok: false, code: 'target-changed', message: `目标技能「${target}」的内容在决策之后被改过；拒绝提交（未写入任何内容）。` }
        }
      }
      if (plan.sourceRevisions !== undefined) {
        for (const [name, expected] of Object.entries(plan.sourceRevisions)) {
          if (!sources.includes(name)) continue
          const live = await this.revisionAnchor(name)
          if (!sameRevisionAnchor(expected, live)) {
            return { ok: false, code: 'source-changed', message: `来源技能「${name}」的内容在决策之后被改过；拒绝提交（未写入任何内容）。` }
          }
        }
      }
      if (plan.supportDigest !== undefined) {
        const fingerprints: string[] = []
        for (const name of [target, ...sources]) {
          const fingerprint = await this.revisionFingerprint(name)
          if (fingerprint !== null) fingerprints.push(fingerprint)
        }
        if (revisionSupportDigest(fingerprints) !== plan.supportDigest) {
          return { ok: false, code: 'support-changed', message: '参与合并的技能支撑文件在决策之后被改过；拒绝提交（未写入任何内容）。' }
        }
      }
      const validation = validateFrontmatter(plan.body, target, limits)
      if (validation) return { ok: false, message: validation }
      const supportPaths = new Set<string>()
      const supportPrevious = new Map<string, string | null>()
      for (const file of plan.supportFiles) {
        const badPath = validateSupportPath(file.path)
        if (badPath) return { ok: false, message: badPath }
        if (supportPaths.has(file.path)) return { ok: false, message: `支撑文件重复：${file.path}` }
        supportPaths.add(file.path)
        if (Buffer.byteLength(file.content, 'utf8') > limits.maxSkillFileBytes) return { ok: false, message: `支撑文件超过 ${limits.maxSkillFileBytes} 字节：${file.path}` }
        const threat = this.contentThreatBlock(file.content)
        if (threat) return { ok: false, message: threat }
        const previous = await this.io.readText(join(dir, ...file.path.replace(/\\/g, '/').split('/').filter(Boolean)))
        supportPrevious.set(file.path, previous)
      }
      for (const ref of supportRefs(plan.body)) {
        if (supportPaths.has(ref)) continue
        const existing = plan.targetExists
          ? await this.io.exists(join(dir, ...ref.replace(/\\/g, '/').split('/').filter(Boolean)))
          : false
        if (!existing) return { ok: false, message: `正文引用了未提供的支撑文件「${ref}」；拒绝提交。` }
      }
      const unitId = plan.unitId ?? ('u-' + Date.now().toString(36) + '-' + (nextUnitSeq += 1).toString(36))
      const supportMoves = plan.supportFiles.map((file) => {
        const previous = supportPrevious.get(file.path) ?? null
        return {
          path: file.path,
          kind: previous === null ? 'created' : 'moved',
          to: file.path,
          ...(previous === null ? {} : { beforeRef: contentHash(previous) }),
          afterRef: contentHash(file.content),
        }
      })
      const unitHead: UnitHead = {
        ...(plan.runId === undefined ? {} : { runId: plan.runId }),
        baseline: true,
        moves: supportMoves,
        sources: [{ skill: target }, ...sources.map(source => ({ skill: source }))],
      }
      const archived: string[] = []
      const rollbackSources = async (): Promise<string[]> => {
        const stuck: string[] = []
        for (const source of [...archived].reverse()) {
          try {
            const restored = await this.restoreFromArchive(source, plan.origin)
            if (!restored.ok) stuck.push(source)
          } catch {
            stuck.push(source)
          }
        }
        return stuck
      }
      const rollbackMessage = (reason: string, stuck: readonly string[]): CommitMergeResult => ({
        ok: false,
        message: stuck.length === 0
          ? `合并失败，已回滚：${reason}`
          : `合并失败（${reason}）；已回滚，但以下未回滚：${stuck.join(', ')}：它们仍在 .archive 里，请用 /evolution skill restore 恢复。`,
      })

      const rollbackTarget = async (): Promise<string[]> => {
        const stuck: string[] = []
        const support = plan.supportFiles.map(file => ({
          target: join(dir, ...file.path.replace(/\\/g, '/').split('/').filter(Boolean)),
          content: supportPrevious.get(file.path) ?? null,
          previous: file.content,
        }))
        const writes: TreeChangeWrite[] = [
          { target: targetPath, content: plan.expectedTargetBody ?? '', expected: plan.body.trimEnd() + '\n' },
          ...support.map(file => ({ target: file.target, content: file.content ?? '', expected: file.previous })),
        ]
        try {
          const restored = await this.applyTreeChange({
            name: target,
            origin: plan.origin,
            protection: 'write',
            writes,
            auditAction: 'merge-rollback',
            auditSummary: 'merge rollback: restore target snapshot',
            eventAction: 'merge-rollback',
            unitId,
            unitHead,
          })
          if (!restored.ok) stuck.push(target)
        } catch {
          stuck.push(target)
        }
        return stuck
      }

      if (plan.targetExists) {
        for (const source of sources) {
          const fresh = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
          if (fresh !== sourceBodies.get(source)) return rollbackMessage(`来源技能「${source}」在归档前被改过`, [])
        }
        const writes: TreeChangeWrite[] = [
          { target: targetPath, content: plan.body.trimEnd() + '\n', expected: plan.expectedTargetBody },
          ...plan.supportFiles.map(file => ({
            target: join(dir, ...file.path.replace(/\\/g, '/').split('/').filter(Boolean)),
            content: file.content,
            expected: supportPrevious.get(file.path) ?? null,
          })),
        ]
        await plan.onPhase?.('target-pending')
        if (plan.assertFence !== undefined && !(await plan.assertFence())) return { ok: false, message: 'tree fence lost before target write' }
        const result = await this.applyTreeChange({
          name: target,
          origin: plan.origin,
          protection: 'write',
          writes,
          auditAction: 'merge',
          auditSummary: plan.summary,
          eventAction: 'merge',
          unitId,
          unitHead,
        })
        if (!result.ok) return rollbackMessage(result.message, [])
        await plan.onPhase?.('target-applied')
        await plan.onPhase?.('target-written')
        if (plan.signal?.aborted) {
          const stuck = await rollbackTarget()
          return rollbackMessage('cancelled before sources archived', stuck)
        }
        for (const source of sources) {
          if (plan.signal?.aborted) {
            const stuck = await rollbackSources()
            stuck.push(...await rollbackTarget())
            return rollbackMessage('cancelled before next source archive', stuck)
          }
          const fresh = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
          if (fresh !== sourceBodies.get(source)) {
            const stuck = await rollbackSources()
            stuck.push(...await rollbackTarget())
            return rollbackMessage(`来源技能「${source}」在归档前被改过`, stuck)
          }
          if (plan.assertFence !== undefined && !(await plan.assertFence())) {
            return { ok: false, message: 'tree fence lost before source archive; recovery required' }
          }
          await plan.onPhase?.('source-archiving', { source })
          const archivedResult = await this.archive(source, {
            absorbedInto: target,
            unitId,
            unitHead: { skill: target },
            reason: `Merged into ${target}`,
          }, plan.origin)
          if (!archivedResult.ok) {
            const stuck = await rollbackSources()
            stuck.push(...await rollbackTarget())
            return rollbackMessage(archivedResult.message, stuck)
          }
          archived.push(source)
        }
        await plan.onPhase?.('sources-archived')
        await this.foldArchivedUsage(sources, new Date().toISOString())
        await plan.onPhase?.('unit-written')
        return { ok: true, message: `已把 ${sources.join(', ')} 合并进「${target}」。`, unitId, targetPath: dir, archived, mutations: 1 + sources.length }
      }

      await plan.onPhase?.('target-pending')
      if (plan.assertFence !== undefined && !(await plan.assertFence())) return { ok: false, message: 'tree fence lost before target write' }
      const created = await this.createCore(target, plan.body, plan.origin, { unitId, unitHead, managed: true })
      if (!created.ok) return { ok: false, message: created.message }
      await plan.onPhase?.('target-applied')
      await plan.onPhase?.('target-written')
      if (plan.signal?.aborted) {
        const targetRollback = await this.archive(target, { reason: 'merge cancelled' }, plan.origin)
        return rollbackMessage('cancelled before sources archived', targetRollback.ok ? [] : [target])
      }
      for (const source of sources) {
        if (plan.signal?.aborted) {
          const stuck = await rollbackSources()
          const targetRollback = await this.archive(target, { reason: 'merge cancelled' }, plan.origin)
          if (!targetRollback.ok) stuck.push(target)
          return rollbackMessage('cancelled before next source archive', stuck)
        }
        const fresh = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
        if (fresh !== sourceBodies.get(source)) {
          const stuck = await rollbackSources()
          const targetRollback = await this.archive(target, { reason: 'merge rolled back' }, plan.origin)
          if (!targetRollback.ok) stuck.push(target)
          return rollbackMessage(`来源技能「${source}」在归档前被改过`, stuck)
        }
        if (plan.assertFence !== undefined && !(await plan.assertFence())) {
          return { ok: false, message: 'tree fence lost before source archive; recovery required' }
        }
        await plan.onPhase?.('source-archiving', { source })
        const result = await this.archive(source, {
          absorbedInto: target,
          unitId,
          unitHead: { skill: target },
          reason: `Merged into ${target}`,
        }, plan.origin)
        if (!result.ok) {
          const stuck = await rollbackSources()
          const targetRollback = await this.archive(target, { reason: 'merge rolled back' }, plan.origin)
          if (!targetRollback.ok) stuck.push(target)
          return rollbackMessage(result.message, stuck)
        }
        archived.push(source)
      }
      if (plan.supportFiles.length > 0) {
        await plan.onPhase?.('support-pending')
        if (plan.assertFence !== undefined && !(await plan.assertFence())) {
          return { ok: false, message: 'tree fence lost before support write; recovery required' }
        }
        const writes: TreeChangeWrite[] = plan.supportFiles.map(file => ({
          target: join(dir, ...file.path.replace(/\\/g, '/').split('/').filter(Boolean)),
          content: file.content,
          expected: supportPrevious.get(file.path) ?? null,
        }))
        const result = await this.applyTreeChange({
          name: target,
          origin: plan.origin,
          protection: 'write',
          writes,
          auditAction: 'merge',
          auditSummary: plan.summary,
          eventAction: 'merge',
          unitId,
          unitHead,
        })
        if (!result.ok) {
          const stuck = await rollbackSources()
          const targetRollback = await this.archive(target, { reason: 'merge rolled back' }, plan.origin)
          if (!targetRollback.ok) stuck.push(target)
          return rollbackMessage(result.message, stuck)
        }
      }
      await this.foldArchivedUsage(sources, new Date().toISOString())
      await plan.onPhase?.('sources-archived')
      await plan.onPhase?.('unit-written')
      return { ok: true, message: `已把 ${sources.join(', ')} 合并进「${target}」。`, unitId, targetPath: dir, archived, mutations: 1 + sources.length }
    })
  }

  /**
   * V2 (design §16.7): what an apply-mode consolidation would do for ONE source,
   * computed BEFORE any side effect. `blocked` means behaviour is exactly the
   * plan-mode refusal (with the reason named); `apply` carries the rewritten body
   * and the support files that must be copied into the target.
   * @param source - the moving skill's name.
   * @param targetName - the destination skill's name.
   * @param body - the moving body (frontmatter stripped).
   * @returns the decision plus the note to append to a refusal.
   */
  private async planSourceRehoming(source: string, targetName: string, body: string, extraTargetFiles: readonly string[] = []): Promise<
    | { kind: 'blocked'; note: string }
    | { kind: 'apply'; note: string; rewritten: string; files: { from: string; to: string; content: string }[] }
  > {
    const policy = this.limits.referenceRewrite ?? DEFAULT_REFERENCE_REWRITE_POLICY
    if (policy === 'off') return { kind: 'blocked', note: '' }
    const sourceFiles = await this.listSupportFiles(source)
    const targetFiles = await this.listSupportFiles(targetName)
    if (!isPresent(sourceFiles) || !isPresent(targetFiles)) return { kind: 'blocked', note: ' plan: unavailable (support-file listing unknown)' }
    // Already-planned destinations count as taken, so two sources cannot both
    // claim the same re-homed path inside one run.
    const { moves, collisions } = planRehoming(sourceFiles.value, [...targetFiles.value, ...extraTargetFiles], source)
    const plan = planReferenceRewrite({
      content: body,
      files: sourceFiles.value,
      moves,
      targetFiles: [...targetFiles.value, ...extraTargetFiles, ...moves.map(move => move.to)],
    })
    const described = ` ${describeReferenceRewrite(plan)}${collisionsNote(collisions)}`
    if (policy === 'plan') return { kind: 'blocked', note: described }
    // apply: the plan must PROVE it leaves nothing dangling, otherwise the merge
    // is refused exactly like `plan` (the refusal names what is in the way).
    if (plan.residualDangling.length > 0 || plan.unresolved.length > 0) {
      return { kind: 'blocked', note: `${described} (cannot apply)` }
    }
    const files: { from: string; to: string; content: string }[] = []
    for (const move of plan.moves) {
      const bytes = await this.io.readText(join(this.dirOf(source), ...move.from.split('/')))
      // An unreadable source file is a hard stop: copying nothing would leave the
      // rewritten reference dangling.
      if (bytes === null) return { kind: 'blocked', note: ` plan: unavailable (cannot read ${move.from})` }
      files.push({ from: move.from, to: move.to, content: bytes })
    }
    return { kind: 'apply', note: described, rewritten: applyReferenceRewrite(body, plan.edits), files }
  }

  /**
   * Merge the bodies of `sources` into `target` and archive the sources with
   * an absorbed-into marker. Hermes-style consolidation: overlapping skills
   * collapse into one, and the originals stay recoverable under `.archive/`.
   *
   * `mode:'append'` (default) appends each source body to the target. The
   * target write goes through the tree-change kernel (009) — byte-level
   * rollback, audit and the mutation event are kernel-owned. Package-integrity
   * (009-I): append-mode consolidation REFUSES a source whose directory has
   * support files or whose body carries support-directory links — an append
   * would leave those references pointing at an archived package (dangling);
   * the refusal message directs to the reference mode / whole-package archive.
   *
   * `mode:'reference'` writes each source's body (frontmatter stripped) into
   * `target/references/<source>.md` and archives the source — the demote path
   * (009-II). A source body with support-directory links is refused there too
   * (the references file would carry links whose files were archived).
   *
   * V2 (design §16.7) lifts that refusal when `referenceRewrite:'apply'` and the
   * plan proves the move is safe: the support files the body NEEDS are copied into
   * the target under their own paths (renamed only on a collision) and the body's
   * references are rewritten to match, in the same commit. Anything the plan
   * cannot place — a cited file the source no longer has, an unreadable listing —
   * still refuses, and the refusal names it. The archived source keeps whatever
   * the body did not need.
   */
  async consolidate(
    target: string,
    sources: string[],
    origin: WriteOrigin = this.authority.origin,
    options: { mode?: 'append' | 'reference' } = {},
  ): Promise<SkillActionResult> {
    // Names normalize before validation (rc.42 audit P2-5): the trimmed form
    // is what every path-building call below resolves to, so validation and
    // IO can never disagree about which skill is meant.
    const targetName = target.trim()
    const normalizedSources = [...new Set(sources.map(name => name.trim()))].filter(name => name !== targetName)
    const mode = options.mode ?? 'append'
    if (normalizedSources.length === 0) return { ok: false, message: '合并至少需要一个互不相同的来源技能。' }
    for (const name of [targetName, ...normalizedSources]) {
      // C-16: the name guard is badName() now — consolidate gains the
      // same 64-char length ceiling and message form as every other mutator.
      const bad = this.badName(name)
      if (bad) return { ok: false, message: bad }
    }
    const targetDir = this.dirOf(targetName)
    const targetProtection = await this.writeProtection(targetName, origin)
    if (targetProtection) return { ok: false, message: `技能「${targetName}」受保护（${targetProtection}）。` }
    // V8-11 (0.3.46): the targetMd pre-read below MOVED into the serial queue
    // (commit section) — a concurrent patch between the old pre-read and the
    // commit used to be silently overwritten by the merged body.
    // OPT-04 (2026-09): the ENTIRE mutation phase — source reads, source
    // archives, target merge, commit and rollback — now runs inside the
    // in-process serialize queue (the same wrapper restructure uses). Before,
    // the source bodies were read OUTSIDE the queue and the commit reused
    // those stale bytes: a patch landing on a SOURCE between its read and its
    // archive was silently dropped from the merged output (lost update — the
    // same defect class V8-11/V24-01 closed for the target side only, now
    // closed for the sources too). archive()/restoreFromArchive() take no
    // serial lock themselves, so the nested calls here cannot self-deadlock.
    // Every refusal below (protection, missing skill, package integrity)
    // still fires before ANY side effect, so the pre-side-effect refusal
    // semantics are unchanged.
    return await this.serial(async (): Promise<SkillActionResult> => {
      const referenceWrites: TreeChangeWrite[] = []
      // V2 (design §16.7): support files copied into the target from an apply-mode
      // source, staged before any side effect and committed in the same tree change.
      const rehomed: { from: string; to: string; content: string }[] = []
      // V3: one pointer block per demoted source (pointer line + link list).
      const demotedPointers: string[][] = []
      const parts: string[] = []
      // S1-E5: the plan-time bytes per source, re-verified right before that
      // source is archived. The serial queue closes the read→merge window for
      // THIS process only; a cross-process writer (shared DSH_HOME, transact
      // is a supported deployment) could still land a patch between the plan
      // read and the archive — the OPT-04 "closed for the sources too" claim
      // was true only in-process. A mismatch aborts through the rollback below.
      const plannedSourceBytes = new Map<string, string>()
      if (mode === 'append') {
        for (const source of normalizedSources) {
          const protection = await this.deleteProtection(source)
          if (protection) return { ok: false, message: `技能「${source}」受保护（${protection}）。` }
          const sourceMd = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
          if (!sourceMd) return { ok: false, message: `技能「${source}」不存在。` }
          const parsed = parseFrontmatter(sourceMd)
          if (!parsed) return { ok: false, message: `技能「${source}」没有有效的 frontmatter；拒绝合并。` }
          // Package integrity (009-I): an append must never leave dangling
          // support links — refuse before ANY side effect (no archive, no write).
          const carriesSupport = await this.countSupportDirs(source) > 0
          const parsedRefs = supportRefs(parsed.body)
          const rawRefs = [...parsed.body.matchAll(/(?:references|scripts|templates|assets)\/[A-Za-z0-9._/-]+/g)].map(match => match[0])
          const refs = parsedRefs.length > 0 ? parsedRefs : rawRefs
          let appendedBody = parsed.body
          if (carriesSupport || refs.length > 0) {
            const decision = await this.planSourceRehoming(source, targetName, parsed.body, rehomed.map(file => file.to))
            if (decision.kind === 'blocked') {
              const reason = carriesSupport
                ? `source "${source}" carries support files`
                : `source "${source}" body references support files (${refs.join(', ')})`
              return { ok: false, message: `合并被拒绝：${reason} 会被落下。请改用 mode:'reference'，或直接归档整个包。${decision.note}` }
            }
            rehomed.push(...decision.files)
            appendedBody = decision.rewritten
          }
          parts.push(`\n<!-- consolidated from ${source} at ${new Date().toISOString()} -->\n${appendedBody.trim()}`)
          plannedSourceBytes.set(source, sourceMd)
        }
      } else {
        for (const source of normalizedSources) {
          const protection = await this.deleteProtection(source)
          if (protection) return { ok: false, message: `技能「${source}」受保护（${protection}）。` }
          const sourceMd = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
          if (!sourceMd) return { ok: false, message: `技能「${source}」不存在。` }
          const parsed = parseFrontmatter(sourceMd)
          if (!parsed) return { ok: false, message: `技能「${source}」没有有效的 frontmatter；拒绝降级。` }
          const refs = supportRefs(parsed.body)
          let demotedBody = parsed.body
          if (refs.length > 0) {
            const decision = await this.planSourceRehoming(source, targetName, parsed.body, rehomed.map(file => file.to))
            if (decision.kind === 'blocked') {
              return { ok: false, message: `合并被拒绝：来源技能「${source}」的正文引用了会被落下的支撑文件（${refs.join(', ')}）：请改为归档整个包。${decision.note}` }
            }
            rehomed.push(...decision.files)
            demotedBody = decision.rewritten
          }
          const target = join(targetDir, 'references', `${source}.md`)
          referenceWrites.push({ target, content: `<!-- demoted from ${source} at ${new Date().toISOString()} -->\n${demotedBody.trim()}\n` })
          // Same convention as restructure: the pointer carries the link list of
          // what the demoted body cited, so the target body keeps mentioning them.
          demotedPointers.push(pointerBlock(`references/${source}.md`, demotedBody))
          plannedSourceBytes.set(source, sourceMd)
        }
        // Discoverability: the umbrella's body gains one pointer per demoted
        // source — built INSIDE the serial queue below against the fresh target
        // (V8-11), so it never merges over a concurrent patch.
      }
      // Two-phase commit so a failure partway never leaves the tree inconsistent:
      // (1) archive every source first — a source that cannot be archived aborts
      //     before target is touched; (2) only when all sources are safely in
      //     .archive does the kernel commit the writes (byte-level rollback).
      const archived: string[] = []
      try {
        // V9-04 (0.3.50): restore the cheap target-existence pre-check BEFORE
        // the destructive archive loop — V8-11 moved the authoritative read into
        // the serial queue, which silently turned a clean "Skill not found"
        // refusal into "archive ALL sources, then roll back" (a half-completed
        // tree when a restore fails). The serial read stays authoritative for
        // the merge; this probe keeps the failure path non-destructive.
        const preTargetMd = await this.io.readText(join(targetDir, 'SKILL.md'))
        if (!preTargetMd) return { ok: false, message: `技能「${targetName}」不存在。` }
        for (const source of normalizedSources) {
          // S1-E5: verify the plan-time bytes right before THIS source is
          // archived. A mismatch throws into the rollback below, so sources
          // archived before the abort are brought back and nothing lands —
          // the cross-process gap the serial queue cannot close.
          if (plannedSourceBytes.has(source)) {
            const freshSource = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
            if (freshSource !== plannedSourceBytes.get(source)) {
              throw new Error(`Consolidation aborted: source "${source}" changed while the consolidation ran (its planned bytes are no longer current).`)
            }
          }
          const result = await this.archive(source, { absorbedInto: targetName })
          if (!result.ok) throw new Error(result.message)
          archived.push(source)
        }
        // V8-11 (0.3.46): the target pre-read and the merged/pointer construction
        // happen INSIDE the in-process serialize queue — a concurrent
        // patch/update between the old pre-read and the commit used to be
        // silently overwritten (the serial chain is the same second layer
        // update/patch/restructure/writeSupportFile use).
        const freshTargetMd = await this.io.readText(join(targetDir, 'SKILL.md'))
        // S1-E1: everything below runs AFTER the sources are already archived —
        // these three exits used to `return`, which skips the catch's rollback
        // (JS: return does not pass through catch) and left every source in
        // .archive while the message implied nothing had happened. Throw so
        // the T-14 rollback below brings them back; the catch prefixes the
        // reason with the rollback outcome, so the reasons here name only the
        // failure itself.
        if (!freshTargetMd) throw new Error(`target "${targetName}" disappeared mid-consolidate`)
        // V10-01 (P2-2): reference-mode targets APPEND, mirroring restructure
        // (base + '\n\n' + new text) — a second consolidate of a re-created
        // source used to overwrite the first demotion's bytes (silent loss of
        // the older degraded knowledge). The previous bytes are read INSIDE
        // the serial queue (V8-11 discipline), so a concurrent patch between
        // planning and commit is never silently overwritten; applyTreeChange
        // re-reads at commit for the rollback bytes.
        const writes: TreeChangeWrite[] = []
        for (const reference of referenceWrites) {
          const previous = await this.readForCas(reference.target)
          const base = previous?.trimEnd() ?? ''
          // V24-01: carry the plan-time bytes as the CAS baseline — a read
          // error here reads as null and stays fail-closed at commit (an
          // existing file then counts as drift).
          writes.push({ target: reference.target, content: base === '' ? reference.content : `${base}\n\n${reference.content}`, expected: previous })
        }
        // V2 (design §16.7): the re-homed support files ride the SAME commit as the
        // merged body — one tree change, one rollback domain, and the body's
        // rewritten references can never be committed without their targets.
        for (const file of rehomed) {
          const target = join(targetDir, ...file.to.split('/'))
          const previous = await this.readForCas(target)
          writes.push({ target, content: file.content, expected: previous })
        }
        if (mode === 'append') {
          const merged = freshTargetMd.trimEnd() + parts.join('\n') + '\n'
          const validation = validateFrontmatter(merged, targetName, this.limits)
          if (validation) throw new Error(`merge validation failed: ${validation}`)
          writes.push({ target: join(targetDir, 'SKILL.md'), content: merged, expected: freshTargetMd })
        } else {
          const pointerLines = demotedPointers.map(lines => `\n${lines.join('\n')}`).join('')
          const extended = freshTargetMd.trimEnd() + pointerLines + '\n'
          const validation = validateFrontmatter(extended, targetName, this.limits)
          if (validation) throw new Error(`merge validation failed: ${validation}`)
          writes.push({ target: join(targetDir, 'SKILL.md'), content: extended, expected: freshTargetMd })
        }
        const result = await this.applyTreeChange({
          name: targetName,
          origin,
          protection: 'write',
          writes,
          auditAction: 'consolidate',
          auditSummary: `consolidated ${normalizedSources.join(', ')} (${mode}) into ${targetName}`
            + (rehomed.length === 0 ? '' : `; re-homed ${rehomed.map(file => `${file.from}->${file.to}`).join(', ')}`),
          eventAction: 'consolidate',
        })
        if (!result.ok) throw new Error(result.message)
        return { ok: true, message: `已把 ${normalizedSources.join(', ')} 合并进「${targetName}」。`, path: targetDir }
      } catch (error) {
        // Bring back every source we already archived so the merge is fully
        // undone. 0.3.16 (T-14): a failed restore used to be swallowed by
        // `.catch(() => {})` while the message still claimed a full rollback —
        // the source stayed in .archive silently. Surface it.
        const reason = error instanceof Error ? error.message : String(error)
        const failedRestores: string[] = []
        for (const source of archived.reverse()) {
          try {
            const restored = await this.restoreFromArchive(source)
            if (!restored.ok) failedRestores.push(source)
          } catch {
            // restoreFromArchive never rejects by contract; if it ever does,
            // count the source as unrestored rather than replacing the report.
            failedRestores.push(source)
          }
        }
        if (failedRestores.length > 0) {
          return { ok: false, message: `合并失败（${reason}）；已回滚，但以下未回滚：${failedRestores.join(', ')}：它们仍在 .archive 里，请用 /evolution skill restore 恢复。` }
        }
        return { ok: false, message: `合并失败，已回滚：${reason}` }
      }
    })
  }

  /**
   * Content-distribution repair (008 batch B, 009-R kernel): move body
   * sections — anchored by their exact `## heading` lines — into references/
   * support files and replace each span with a pointer line. The skill
   * name/dir never change (routing stays; only content location shifts, so a
   * fat body sheds its log-like detail). Deterministic, never automatic:
   * candidates come from an approved review plan. The write batch goes
   * through the tree-change kernel — one commit point, byte-level rollback.
   * Package integrity (009-R): a moved section whose text carries
   * support-directory links is refused (those links' files stay behind in the
   * same package; the moved text belongs in references/ beside them).
   */
  async restructure(
    rawName: string,
    moves: SkillRestructureMove[],
    origin: WriteOrigin = this.authority.origin,
  ): Promise<SkillActionResult> {
    const name = rawName.trim()
    await this.ensureRecovered()
    // F-208: the whole read→plan→write runs under the in-process serialize
    // queue so two concurrent restructures on one skill never interleave.
    return await this.restructureCore(name, moves, origin)
  }

  private async restructureCore(name: string, moves: SkillRestructureMove[], origin: WriteOrigin): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    if (moves.length === 0) return { ok: false, message: '重构至少需要一次章节搬移。' }
    if (moves.length > MAX_RESTRUCTURE_MOVES) return { ok: false, message: `重构超过 ${MAX_RESTRUCTURE_MOVES} 次搬移。` }
    for (const move of moves) {
      // V24-20a (v24): element-shape guard BEFORE the field reads — a null
      // element used to throw on `move.heading` instead of returning the
      // structured refusal the library owes every entry point. The `unknown`
      // view is deliberate: the declared element type promises an object, but
      // model/plan payloads have historically crossed that promise (V8-09).
      const raw: unknown = move
      if (raw === null || typeof raw !== 'object') {
        return { ok: false, message: '每次重构搬移都必须是带 heading 的对象。' }
      }
      if (typeof move.heading !== 'string' || !move.heading.trim()) {
        return { ok: false, message: '每次重构搬移都需要非空的 heading。' }
      }
      // A1-6 (v18): reuse the single validator (regex + Windows device stems)
      // so restructure cannot mint a target the support-file layer refuses.
      const targetIssue = validateRestructureTarget(move.toFile)
      if (targetIssue) return { ok: false, message: targetIssue }
    }
    const dir = this.dirOf(name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `技能「${name}」不存在。` }
    // 0.3.16 (E-38/E-38a): the block boundary once used the loose
    // indexOf('\n---', 3) form, which matched a `----` line and leaked
    // frontmatter into the body — frontmatterBlock owns the strict line rule
    // (P3-3). Planning runs on a \n-normalized body, but the final SKILL.md
    // re-uses the file's own line ending so a CRLF file keeps them (E-38a).
    // The body slice is byte-based (md.slice(header.length)) so the newline
    // AFTER the closing `---` stays with the body — a line-based slice would
    // consume it as the separator and splice the first body line onto the
    // closing fence.
    const block = frontmatterBlock(md)
    if (!block) return { ok: false, message: 'SKILL.md 没有有效的 frontmatter；拒绝重构。' }
    // P1-1 (v7 audit): the planner must receive the BODY ONLY — its rebuilt
    // body is spliced after the frontmatter header, so feeding it the full
    // text duplicated the frontmatter on every successful restructure (a
    // second `---` block the lenient parser tolerated but strict YAML
    // consumers read as duplicate name/description keys).
    const header = block.lines.slice(0, block.end + 1).join('\n')
    const bodyRaw = md.slice(header.length)
    const plan = planRestructureSections(bodyRaw.replace(/\r\n/g, '\n'), moves)
    if ('error' in plan) return { ok: false, message: `重构被拒绝：${plan.error}` }
    const newMd = `${header}${plan.body}`.replace(/\r\n/g, '\n')
    const finalMd = block.nl === '\r\n' ? newMd.replace(/\n/g, '\r\n') : newMd
    const newMdCheck = validateFrontmatter(finalMd, name, this.limits)
    if (newMdCheck) return { ok: false, message: `重构被拒绝：${newMdCheck}` }
    // Design §2.2: the refusal is scoped to the case it exists for. A section
    // carrying citations used to be refused outright — which blocked the ONLY
    // non-destructive way to shrink a citation-dense body (measured: 10/10
    // sections of the family's own maintenance skill). Nothing LEAVES the skill
    // on a restructure, so the failure mode is not "dangling" but "a citation
    // whose target does not exist": that is what is checked here. An
    // unavailable file listing keeps the conservative token scan — unknown never
    // passes on a write path.
    const policy = this.limits.citationPolicy ?? DEFAULT_CITATION_POLICY
    const listing = policy === 'refuse' ? null : await this.listSupportFiles(name)
    const files = listing !== null && isPresent(listing) ? listing.value : null
    for (const section of plan.sections) {
      const refs = supportRefs(section.text)
      if (refs.length === 0) continue
      if (files === null) {
        return { ok: false, message: `重构被拒绝：章节「## ${section.heading}」引用了会留在原地的支撑文件（${refs.join(', ')}）：请拆开该章节，或连同它的文件一起搬。` }
      }
      const report = resolveCitations({ content: section.text, file: 'SKILL.md', files })
      if (report.dangling.length > 0) {
        const missing = report.dangling.map(ref => ref.target ?? ref.raw).join(', ')
        return { ok: false, message: `重构被拒绝：章节「## ${section.heading}」引用的支撑文件不存在（${missing}）：请修正引用，或先创建该文件。` }
      }
    }
    // Aggregate by destination: two moves into one file append in move order.
    const byRel = new Map<string, { rel: string; texts: string[] }>()
    for (const section of plan.sections) {
      const entry = byRel.get(section.rel) ?? { rel: section.rel, texts: [] }
      entry.texts.push(section.text)
      byRel.set(section.rel, entry)
    }
    const writes: TreeChangeWrite[] = []
    for (const entry of byRel.values()) {
      const target = join(dir, ...entry.rel.split('/'))
      const previous = await this.readForCas(target)
      const base = previous?.trimEnd() ?? ''
      writes.push({
        target,
        content: base === '' ? entry.texts.join('\n\n') : `${base}\n\n${entry.texts.join('\n\n')}`,
        // V24-01: plan-time bytes as the CAS baseline (fail-closed on a read
        // error: `previous` is null then, so an existing file counts as drift).
        expected: previous,
      })
    }
    writes.push({ target: join(dir, 'SKILL.md'), content: finalMd, expected: md })
    const protection = await this.writeProtection(name, origin)
    if (protection !== null) return { ok: false, message: `技能「${name}」受保护（${protection}）。` }
    const summary = `moved ${plan.sections.length} section(s): ${[...byRel.keys()].join(', ')}`
    const ops: TreeChangeOp[] = writes.map(write => ({
      kind: 'write' as const,
      target: write.target,
      content: write.content,
      ...(write.expected === undefined ? {} : { expected: write.expected }),
      skill: name,
    }))
    const hooks: MutationUnitHooks = {
      committed: async event => {
        let headPlaced = false
        for (const op of event.ops) {
          const rel = relative(dir, op.target).split(String.fromCharCode(92)).join('/')
          await this.audit(name, 'restructure', op.before, op.after, summary, rel === 'SKILL.md' ? undefined : rel, event.unitId, headPlaced ? undefined : this.unitHeadForOps(event.ops, [name]), origin)
          headPlaced = true
        }
        this.notifyMutation({ action: 'restructure', name, skillDir: dir })
      },
    }
    const home = dirname(this.root)
    const unit = new MutationUnit({
      io: this.io,
      limits: { maxSkillFileBytes: this.limits.maxSkillFileBytes, maxSkillContentChars: this.limits.maxSkillContentChars },
      serial: this.serial,
      lock: fileMutationLock(this.io, this.root),
      journal: unitJournalPort(this.io, home),
      snapshots: unitSnapshotPort(this.io, home),
      hooks,
      validateWrite: op => op.kind === 'write' ? this.contentThreatBlock(op.content) : null,
    })
    const result = await unit.apply({
      name,
      origin,
      roots: [{ name, protection: 'write' as const }],
      rootDirs: { [name]: dir },
      ops,
      auditAction: 'restructure',
      auditSummary: summary,
      eventAction: 'restructure',
    })
    if (!result.ok) return { ok: false, message: result.errors.map(error => error.message).join('；') }
    return { ok: true, message: `已重构「${name}」：把 ${plan.sections.length} 个章节搬到 references/。`, path: dir }
  }

  /**
   * Unified tree-change commit point (009 kernel): owns validation order,
   * pre-read rollback bytes, two-phase write with byte-level rollback, audit
   * and the mutation event. Mutators compose `TreeChangePlan`s — consolidate,
   * restructure (and future reference-mode consolidations) never implement
   * two-phase commit themselves.
   */
  /**
   * Apply one G1 ExtractPlan as one cross-skill unit. This is a thin adapter:
   * selection, residual, pointer and support closure were already decided by
   * planExtract; this method only projects them into ordered kernel operations.
   * @param plan - pure plan from extract-plan.ts.
   * @param origin - write face recorded in the audit ledger.
   * @returns the kernel result; a refusal writes nothing.
   */
  async extract(plan: ExtractPlanDraft, origin: WriteOrigin = this.authority.origin): Promise<SkillActionResult> {
    await this.ensureRecovered()
    if (plan.outcome === 'owner-gap' || plan.owner.mode !== 'covered') return { ok: false, message: '提取被拒绝：owner-gap 不是写操作。' }
    if (plan.support.unresolved.length > 0 || plan.support.dangling.length > 0) return { ok: false, message: '提取被拒绝：support closure 存在 unresolved/dangling。' }
    if (plan.parts.length === 0) return { ok: false, message: '提取被拒绝：没有 part。' }
    const source = plan.source.trim()
    const target = plan.target.name.trim()
    if (source === target) return { ok: false, message: '提取被拒绝：source 与 target 相同。' }
    if (plan.target.exists !== true) return { ok: false, message: '提取被拒绝：target 不存在；owner-gap 不自动 create。' }
    const sourceDir = this.dirOf(source)
    const targetDir = this.dirOf(target)
    const sourceMd = await this.io.readText(join(sourceDir, 'SKILL.md'))
    const targetMd = await this.io.readText(join(targetDir, 'SKILL.md'))
    if (sourceMd === null) return { ok: false, message: '技能「' + source + '」不存在。' }
    if (targetMd === null) return { ok: false, message: '技能「' + target + '」不存在。' }
    if (plan.anchors !== undefined) {
      const sourceHash = contentHash(sourceMd)
      const targetHash = contentHash(targetMd)
      if (sourceHash !== plan.anchors.sourceMdSha256 || targetHash !== plan.anchors.targetMdSha256) {
        return { ok: false, message: '提取被拒绝：source/target 在计划之后发生了变化；请重新计划。' }
      }
    }
    const projected = projectExtractBodies(plan, sourceMd, targetMd)
    if (!projected.ok) return { ok: false, message: '提取被拒绝：' + projected.message }
    const sourceNew = projected.projection.sourceAfter
    const targetNew = projected.projection.targetAfter
    const ops: TreeChangeOp[] = []
    for (const move of [...plan.support.shared, ...plan.support.exclusive]) {
      const fromPath = join(sourceDir, ...move.from.split('/'))
      const toPath = join(targetDir, ...move.to.split('/'))
      const content = await this.io.readText(fromPath)
      if (content === null) return { ok: false, message: '提取被拒绝：support 文件不存在 ' + move.from }
      const previous = await this.readForCas(toPath)
      ops.push({ kind: 'write', target: toPath, content, expected: previous, skill: target })
    }
    for (const file of plan.support.external) {
      if (file.content === undefined) return { ok: false, message: '提取被拒绝：external support 缺少已验证的内容 ' + file.from }
      if (file.to.startsWith('/') || file.to.includes('..') || !/^(?:references|templates|scripts|assets)\//.test(file.to)) {
        return { ok: false, message: '提取被拒绝：external target 不安全 ' + file.to }
      }
      const toPath = join(targetDir, ...file.to.split('/'))
      const previous = await this.readForCas(toPath)
      ops.push({ kind: 'write', target: toPath, content: file.content, expected: previous, skill: target })
    }
    ops.push({ kind: 'write', target: join(targetDir, 'SKILL.md'), content: targetNew, expected: targetMd, skill: target })
    for (const move of plan.support.exclusive) {
      const sourcePath = join(sourceDir, ...move.from.split('/'))
      const previous = await this.readForCas(sourcePath)
      if (previous === null) return { ok: false, message: '提取被拒绝：待删除 support 不存在 ' + move.from }
      ops.push({ kind: 'delete', target: sourcePath, expected: previous, skill: source })
    }
    ops.push({ kind: 'write', target: join(sourceDir, 'SKILL.md'), content: sourceNew, expected: sourceMd, skill: source })
    const targetSummary = (await this.list({ withFrontmatter: true })).find(summary => summary.name === target)
    if (targetSummary === undefined) return { ok: false, message: '提取被拒绝：target 不在技能库中。' }
    if (!targetSummary.managed) return { ok: false, message: '提取被拒绝：target 不是家族管理的技能。' }
    for (const name of [source, target]) {
      const protection = await this.writeProtection(name, origin)
      if (protection !== null) return { ok: false, message: '技能「' + name + '」受保护（' + protection + '）。' }
    }
    const summary = 'extract ' + plan.parts.map(part => part.heading).join(', ') + ' from ' + source + ' to ' + target
    const roots = [source, target]
    const hooks: MutationUnitHooks = {
      committed: async event => {
        const provenance = new Map<string, string>()
        for (const move of [...plan.support.shared, ...plan.support.external]) provenance.set(join(targetDir, ...move.to.split('/')), move.provenance)
        const head: UnitHead = this.unitHeadForOps(event.ops, roots, provenance)
        let headPlaced = false
        for (const op of event.ops) {
          if (op.skill === undefined) continue
          const rel = relative(this.dirOf(op.skill), op.target).split(String.fromCharCode(92)).join('/')
          await this.audit(op.skill, 'extract', op.before, op.after, summary, rel === 'SKILL.md' ? undefined : rel, event.unitId, headPlaced ? undefined : head, origin)
          headPlaced = true
        }
        for (const name of roots) this.notifyMutation({ action: 'extract', name, skillDir: this.dirOf(name) })
      },
    }
    const home = dirname(this.root)
    const unit = new MutationUnit({
      io: this.io,
      limits: { maxSkillFileBytes: this.limits.maxSkillFileBytes, maxSkillContentChars: this.limits.maxSkillContentChars },
      serial: this.serial,
      lock: fileMutationLock(this.io, this.root),
      journal: unitJournalPort(this.io, home),
      snapshots: unitSnapshotPort(this.io, home),
      hooks,
      validateWrite: op => op.kind === 'write' ? this.contentThreatBlock(op.content) : null,
    })
    const result = await unit.apply({
      name: source,
      origin,
      roots: roots.map(name => ({ name, protection: 'write' as const })),
      rootDirs: Object.fromEntries(roots.map(name => [name, this.dirOf(name)])),
      ops,
      auditAction: 'extract',
      auditSummary: summary,
      eventAction: 'extract',
    })
    if (!result.ok) return { ok: false, message: '提取失败：' + result.errors.map(error => error.message).join('；') }
    return { ok: true, message: summary + ' succeeded.', path: this.dirOf(source) }
  }

  private async applyTreeChange(plan: TreeChangePlan): Promise<SkillActionResult> {
    const primaryName = plan.name.trim()
    const declared = plan.roots ?? [{ name: primaryName, protection: plan.protection }]
    const roots: Array<{ name: string; protection: 'write' | 'delete' | 'none'; dir: string }> = []
    for (const root of declared) {
      const name = root.name.trim()
      if (roots.some(entry => entry.name === name)) return { ok: false, message: '目录树变更声明了重复的根「' + name + '」。' }
      const badName = this.badName(name, { allowReserved: true })
      if (badName) return { ok: false, message: badName }
      const dir = this.dirOf(name)
      const body = await this.io.readText(join(dir, 'SKILL.md'))
      if (!body) return { ok: false, message: '技能「' + name + '」不存在。' }
      const protection = root.protection === 'write'
        ? await this.writeProtection(name, plan.origin)
        : root.protection === 'delete'
          ? await this.deleteProtection(name)
          : null
      if (protection) return { ok: false, message: '技能「' + name + '」受保护（' + protection + '）。' }
      roots.push({ name, protection: root.protection, dir })
    }
    if (!roots.some(root => root.name === primaryName)) {
      return { ok: false, message: '目录树变更的 primary skill「' + primaryName + '」不在 roots 中。' }
    }
    const provided: TreeChangeOp[] = plan.ops ?? [
      ...plan.writes.map(write => ({ kind: 'write' as const, ...write })),
      ...(plan.deletes ?? []).map(del => ({ kind: 'delete' as const, ...del })),
    ]
    if (provided.length === 0) return { ok: false, message: '目录树变更为空。' }
    const landing: Array<{
      kind: 'write' | 'delete'
      target: string
      content: string | null
      previous: string | null
      expected: string | null | undefined
      skill: string
      dir: string
      rel: string
    }> = []
    for (const op of provided) {
      const owner = roots.find(root => {
        const rel = relative(root.dir, op.target)
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
      })
      if (owner === undefined) return { ok: false, message: '目标不属于任何声明的技能根：' + op.target }
      const skill = op.skill ?? owner.name
      if (!roots.some(root => root.name === skill)) return { ok: false, message: '目标声明的技能「' + skill + '」不在 roots 中：' + op.target }
      let previous: string | null
      try {
        previous = await this.io.readText(op.target)
      } catch (error) {
        return { ok: false, message: '拒绝目录树变更：无法安全预读 ' + op.target + '（' + (error instanceof Error ? error.message : String(error)) + '）；未执行任何写入' }
      }
      if (op.kind === 'delete' && previous === null) return { ok: false, message: '拒绝目录树变更：删除目标不存在 ' + op.target }
      if (op.kind === 'write') {
        if (Buffer.byteLength(op.content, 'utf8') > this.limits.maxSkillFileBytes) {
          return { ok: false, message: '写入超过 ' + this.limits.maxSkillFileBytes + ' 字节：' + op.target }
        }
        const threat = this.contentThreatBlock(op.content)
        if (threat) return { ok: false, message: threat }
      }
      const rel = relative(owner.dir, op.target).split(String.fromCharCode(92)).join('/')
      landing.push({ kind: op.kind, target: op.target, content: op.kind === 'write' ? op.content : null, previous, expected: op.expected, skill, dir: owner.dir, rel })
    }
    const written: Array<{ target: string; previous: string | null }> = []
    let durabilityWarning = ''
    try {
      for (const entry of landing) {
        try {
          if (this.transact) {
            const baseline = entry.expected === undefined ? entry.previous : entry.expected
            const drift = { seen: false }
            const ran = { done: false }
            await this.transact(this.io, entry.target, (current) => {
              drift.seen = false
              ran.done = true
              if (current !== baseline) {
                drift.seen = true
                return current
              }
              return entry.kind === 'delete' ? null : entry.content
            })
            if (!ran.done) throw new Error('internal error: the write transaction for ' + entry.target + ' did not invoke the task; nothing was written')
            if (drift.seen) throw new Error('concurrent modification detected: ' + entry.target + ' changed after the plan was computed (a concurrent writer won the race); no further writes were performed')
          } else if (entry.kind === 'delete') {
            await this.io.remove(entry.target)
          } else {
            await this.io.writeText(entry.target, entry.content ?? '')
          }
        } catch (error) {
          if (!isCommittedOnly(error)) throw error
          durabilityWarning = error instanceof Error ? error.message : String(error)
        }
        written.push({ target: entry.target, previous: entry.previous })
      }
    } catch (error) {
      const stuck: string[] = []
      for (const entry of written.reverse()) {
        try {
          if (entry.previous === null) await this.io.remove(entry.target)
          else await this.io.writeText(entry.target, entry.previous)
        } catch {
          stuck.push(entry.target)
        }
      }
      const reason = error instanceof Error ? error.message : String(error)
      if (stuck.length === 0) return { ok: false, message: '目录树变更失败，已回滚：' + reason }
      return { ok: false, message: '目录树变更失败：' + reason + '。回滚无法恢复 ' + stuck.join(', ') + '：可恢复性由当前快照决定：' + (await this.snapshotRecoveryAvailability()) + ' —— 若上面不是「最新快照」，请重新应用这次变更。' }
    }
    const unitId = plan.unitId ?? 'u-' + Date.now().toString(36) + '-' + (nextUnitSeq += 1).toString(36)
    const defaultHead: UnitHead = {
      moves: landing
        .filter(entry => basename(entry.target) !== 'SKILL.md')
        .map(entry => ({
          path: entry.rel,
          kind: entry.kind === 'delete' ? 'removed' : entry.previous === null ? 'created' : 'moved',
          ...(entry.previous === null ? {} : { beforeRef: contentHash(entry.previous) }),
          ...(entry.kind === 'delete' || entry.content === null ? {} : { afterRef: contentHash(entry.content) }),
        })),
      sources: roots.map(root => ({ skill: root.name })),
    }
    const affected = new Set<string>()
    for (let index = 0; index < landing.length; index += 1) {
      const entry = landing[index]
      if (entry === undefined) continue
      await this.audit(entry.skill, plan.auditAction, entry.previous, entry.kind === 'delete' ? null : entry.content, plan.auditSummary, entry.rel === 'SKILL.md' ? undefined : entry.rel, unitId, index === 0 ? (plan.unitHead ?? defaultHead) : undefined, plan.origin)
      affected.add(entry.skill)
    }
    for (const skill of affected) {
      const dir = roots.find(root => root.name === skill)?.dir
      if (dir !== undefined) this.notifyMutation({ action: plan.eventAction, name: skill, skillDir: dir })
    }
    const primaryDir = roots.find(root => root.name === primaryName)?.dir ?? roots[0]?.dir ?? ''
    return {
      ok: true,
      message: durabilityWarning === ''
        ? plan.eventAction + ' "' + primaryName + '" succeeded.'
        : plan.eventAction + ' "' + primaryName + '" succeeded （警告：写入已落盘，但目录 fsync 失败 —— 持久性未确认：' + durabilityWarning + ')',
      path: primaryDir,
    }
  }

  /**
   * Restore one skill from `.archive/` back to the active root. Hermes-style
   * recoverability: archival never deletes, and this is the control-plane
   * path back. The `.archive-reason` marker is dropped on restore.
   */
  async restoreFromArchive(rawName: string, origin: WriteOrigin = this.authority.origin): Promise<SkillActionResult> {
    const name = rawName.trim()
    // P2-2 (v11): the inline regex + hand-written message bypassed badName()
    // (C-12 single source — the regex carries no length bound, so a >64-char
    // name used to pass here). Reserved names allowed: recovery of a legacy
    // entry; on win32 the mkdir fails with a raw errno (documented).
    const bad = this.badName(name, { allowReserved: true })
    if (bad) return { ok: false, message: bad }
    // A1-20 (v18): probe the destination DIRECTORY, not only its SKILL.md. A
    // directory without SKILL.md (partial/hand-made) used to fall through to
    // moveDir's dest-exists failure, whose message named a different obstacle.
    const dest = this.dirOf(name)
    if (await this.io.exists(dest)) {
      const hasSkillFile = await this.io.exists(join(dest, 'SKILL.md'))
      return {
        ok: false,
        message: hasSkillFile
          ? `技能「${name}」已存在于当前根目录；拒绝覆盖。`
          : `技能目录「${name}」已存在于当前根目录，但没有 SKILL.md；恢复前请先移除或修复它。`,
      }
    }
    // OPT-08 (2026-09): case-variant collision probe, the restore-side twin of
    // create()'s D-6 scan. The exact-name probe above passes when a
    // DIFFERENTLY-CASED sibling directory already exists (hand maintenance, a
    // git round-trip on a case-sensitive filesystem) and the restore then
    // created a second same-name-different-case skill: duplicate catalog
    // entries and an ambiguous consolidate/patch target. Case-insensitive
    // filesystems are already covered by the exists() probe; this closes the
    // POSIX side.
    let caseVariant: string | undefined
    try {
      const rootEntries = await this.io.list(this.root)
      caseVariant = rootEntries.find(entry => entry !== name && entry.toLowerCase() === name.toLowerCase())
    } catch {
      // An unreadable root fails loudly at the move below; this probe must
      // not mask that error with an invented refusal.
    }
    if (caseVariant !== undefined) {
      return {
        ok: false,
        message: `技能「${caseVariant}」（同名、仅大小写不同）已存在于当前根目录；把「${name}」恢复到它旁边会造成含义不清的重复：请恢复为「${caseVariant}」，或先移除该变体。`,
      }
    }
    const archiveRoot = join(this.root, '.archive')
    let entries: string[]
    try { entries = await this.io.list(archiveRoot) } catch { return { ok: false, message: '没有可用的技能归档。' } }
    // 0.3.16 (E-3): `${name}-` also matches a SIBLING skill's archive entry
    // (restoring `foo` used to pick `foo-bar` after a lexical sort: foo got
    // foo-bar's content and foo-bar's archive vanished). The directory stamp
    // makes the name unique, not the owner — verify each candidate's own
    // SKILL.md frontmatter name before restoring.
    //
    // V27 G8.4: three signals can identify the owner, in decreasing authority:
    // the `.archive-name` marker this store now writes, the archived
    // SKILL.md frontmatter, and — only for a candidate whose directory name is
    // EXACTLY the requested name — the directory itself. The last one is what
    // makes an entry with a 0-byte SKILL.md recoverable; it stays safe because a
    // sibling cannot own the exact name (a sibling would be `foo-bar<TAB>`).
    const candidates = entries.filter(entry => entry === name || entry.startsWith(`${name}-`)).sort().reverse()
    let chosen: string | undefined
    const unreadable: string[] = []
    for (const candidate of candidates) {
      // O-7 / PLAN S3.2 (audit 1-2): a read FAILURE is not "no marker" and not "no file". The
      // marker decides only when it produced bytes, and an unreadable SKILL.md sends the candidate
      // to `unreadable` (the list the refusal below names) instead of letting the exact-name
      // shortcut claim it — the same A1-17 rule this file's list() already applies.
      const markerProbe = await probeText(this.io, join(archiveRoot, candidate, '.archive-name'))
      if (isUnknown(markerProbe)) { unreadable.push(candidate); continue }
      const marked = isPresent(markerProbe) ? markerProbe.value.trim() : ''
      if (marked === name) { chosen = candidate; break }
      const mdProbe = await probeText(this.io, join(archiveRoot, candidate, 'SKILL.md'))
      if (isUnknown(mdProbe)) { unreadable.push(candidate); continue }
      const parsed = parseFrontmatter(isPresent(mdProbe) ? mdProbe.value : '')
      if (parsed?.frontmatter.name === name) { chosen = candidate; break }
      if (parsed === null && candidate === name) { chosen = candidate; break }
      if (parsed === null) unreadable.push(candidate)
    }
    if (!chosen) {
      if (unreadable.length === 0) return { ok: false, message: `技能「${name}」不在 .archive 里。` }
      return {
        ok: false,
        message: `.archive 里没有「${name}」对应的 frontmatter 名，但有 ${unreadable.length} 个名字相似的归档项：${unreadable.join(', ')}。`
          + `这些归档项没有可读的 SKILL.md（或名字对不上），按名字恢复无法区分它们：请把目录改成技能名后再次恢复；快照这条路的当前状态是：${await this.snapshotRecoveryAvailability()}。`,
      }
    }
    const source = join(archiveRoot, chosen)
    // Symlink guard (G7): restoring a symlinked archive entry would recreate a
    // link in the active tree instead of the real content — refuse first.
    if (this.io.isSymlink) {
      const link = await this.io.isSymlink(source)
      if (link === true) return { ok: false, message: `归档项「${chosen}」是符号链接；拒绝恢复。` }
    }
    // P2-9 (v15): same writer-collision probe as archive — restoring ONTO a
    // skill a writer is mid-write on would drop the new bytes behind the
    // restored tree.
    if (await this.supportDirsUnlistable(dest)) {
      return { ok: false, message: `无法检查技能「${name}」是否有写入方（有一个支撑目录列不出来）：请重试恢复。` }
    }
    const moveFailure = await this.moveDir(source, dest)
    if (moveFailure !== undefined) {
      // 0.3.16 (E-13 follow-up): the fallback failure must come back as a
      // structured result, never a rejection — consolidates call this in a
      // rollback loop and a throw there would replace the rollback report.
      return { ok: false, message: `从 .archive 恢复「${name}」失败：${moveFailure}` }
    }
    // P2 (v16): scrub lock residue that rode inside the archived entry (a
    // crashed writer, or the archive-probe TOCTOU strand) — a live-pid lock
    // landing in the live root structurally closes the writers' self-heal and
    // would keep the restored skill unwritable until process restart.
    for (const marker of ['.archive-reason', '.archive-name']) {
      // V27 G8.4: both markers are archive-directory metadata — dropping them is
      // what keeps a restored tree identical to the tree that was archived.
      if (await this.io.exists(join(dest, marker))) {
        await this.io.remove(join(dest, marker))
      }
    }
    // P3 (v15): `.mutations.json` documents "records every skill mutation" —
    // restore (including consolidate's rollback restores) was the one
    // mutation invisible in the audit history. before=null (absent from the
    // tree), after=the restored SKILL.md bytes (best-effort read).
    // O-7 / PLAN S3.2: the audit records the restored bytes. A read FAILURE is not "no bytes" —
    // `null` here means the file has none — so the degradation is called out instead of being
    // written into the mutation trail as an absent `after`.
    const restoredProbe = await probeText(this.io, join(dest, 'SKILL.md'))
    if (isUnknown(restoredProbe)) {
      console.warn(`evolution-skill-store: the restored SKILL.md of "${name}" could not be read back (${restoredProbe.reason}); the restore is recorded without after-bytes`)
    }
    await this.audit(name, 'restore', null, isPresent(restoredProbe) ? restoredProbe.value : null, `restored from ${source}`, undefined, undefined, undefined, origin)
    this.notifyMutation({ action: 'restore', name, skillDir: dest })
    return { ok: true, message: `技能「${name}」已从 .archive 恢复。`, path: dest }
  }

  async writeSupportFile(
    rawName: string,
    filePath: string,
    content: string,
    origin: WriteOrigin = this.authority.origin,
    anchor?: WriteAnchor,
  ): Promise<SkillActionResult> {
    const name = rawName.trim()
    return await this.writeSupportFileCore(name, filePath, content, origin, anchor)
  }

  private async writeSupportFileCore(
    name: string,
    filePath: string,
    content: string,
    origin: WriteOrigin,
    anchor?: WriteAnchor,
  ): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    if (!await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `技能「${name}」不存在。` }
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `技能「${name}」受保护（${protection}）。` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
    if (Buffer.byteLength(content, 'utf8') > this.limits.maxSkillFileBytes) return { ok: false, message: `支撑文件超过 ${this.limits.maxSkillFileBytes} 字节。` }
    const threat = this.contentThreatBlock(content)
    if (threat) return { ok: false, message: threat }
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    const probe = await probeText(this.io, target)
    if (isUnknown(probe)) return unreadableTarget(name + '/' + filePath, probe.reason)
    const current = isPresent(probe) ? probe.value : null
    const verdict = anchorVerdict(anchor, current)
    if (verdict !== 'match') return anchorRefusalFile(name, filePath, verdict)
    const overCap = exceedsContentLimit(content, this.limits.maxSkillContentChars)
    const repairing = shrinksOverLimit(content, current, this.limits.maxSkillContentChars)
    const capAdvisory = overCap && !repairing
      ? ` Warning: ${content.length} characters is over the ${this.limits.maxSkillContentChars}-character cap upstream applies to every file; plan a split.`
      : ''
    if (overCap && !repairing && this.supportFileCharPolicy() === 'enforce') {
      await this.recordHardCapHit(name, content.length, 'write_file', 1)
      return { ok: false, message: `支撑文件「${filePath}」的内容超过 ${this.limits.maxSkillContentChars} 个字符。${CONTENT_SPLIT_HINT}` }
    }
    if (current !== null && content.trimEnd() === current.trimEnd()) {
      return { ok: true, message: `支撑文件「${filePath}」未变更：提供的内容与当前文件一致，未写入。`, noop: true, path: target }
    }
    const unit = new MutationUnit({
      io: this.io,
      limits: { maxSkillFileBytes: Number.MAX_SAFE_INTEGER, maxSkillContentChars: Number.MAX_SAFE_INTEGER },
      serial: this.serial,
      lock: fileMutationLock(this.io, this.root),
      journal: unitJournalPort(this.io, dirname(this.root)),
      snapshots: unitSnapshotPort(this.io, dirname(this.root)),
      ...(this.transact === undefined ? {} : { transact: this.transact }),
      hooks: {
        committed: async event => {
          const op = event.ops[0]
          if (op === undefined) return
          await this.audit(name, 'write_file', op.before, op.after, `wrote ${filePath}`, filePath, event.unitId, undefined, origin)
          this.notifyMutation({ action: 'write_file', name, skillDir: dir, file: target })
        },
      },
      validateWrite: op => op.kind === 'write' ? this.contentThreatBlock(op.content) : null,
    })
    const result = await unit.apply({
      name,
      origin,
      roots: [{ name, protection: 'write' }],
      rootDirs: { [name]: dir },
      ops: [{ kind: 'write', target, content, expected: current, skill: name }],
      auditAction: 'write_file',
      auditSummary: `wrote ${filePath}`,
      eventAction: 'write_file',
    })
    if (!result.ok) return { ok: false, message: result.errors.map(error => error.message).join('；') }
    const warning = result.warnings === undefined || result.warnings.length === 0 ? '' : ` （警告：写入已落盘，但目录 fsync 失败 —— 持久性未确认：${result.warnings.join('；')})`
    return { ok: true, message: `支撑文件「${filePath}」已写入「${name}」。${capAdvisory}${warning}`, path: target }
  }

  async removeSupportFile(
    rawName: string,
    filePath: string,
    origin: WriteOrigin = this.authority.origin,
    anchor?: WriteAnchor,
    unitId?: string,
  ): Promise<SkillActionResult> {
    return await this.serial(() => this.removeSupportFileCore(rawName.trim(), filePath, origin, anchor, unitId))
  }

  private async removeSupportFileCore(
    name: string,
    filePath: string,
    origin: WriteOrigin,
    anchor?: WriteAnchor,
    unitId?: string,
  ): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    if (!await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `技能「${name}」不存在。` }
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `技能「${name}」受保护（${protection}）。` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    if (!await this.io.exists(target)) {
      if (anchor !== undefined) return anchorRefusalFile(name, filePath, 'missing')
      return { ok: false, message: `文件「${filePath}」不在技能「${name}」里。` }
    }
    const beforeProbe = await probeText(this.io, target)
    if (!isPresent(beforeProbe)) {
      if (isUnknown(beforeProbe)) console.warn(`skill-store: could not read ${target} before removing it (${beforeProbe.reason}); refusing the removal`)
      return { ok: false, message: `"${filePath}" is not a readable regular file — remove the files inside it one by one.` }
    }
    const before = beforeProbe.value
    let verdict = anchorVerdict(anchor, before)
    let lockedBefore = before
    if (verdict === 'match' && this.transact) {
      const ran = { done: false }
      await this.transact(this.io, target, (current) => {
        ran.done = true
        verdict = anchorVerdict(anchor, current)
        if (verdict === 'match' && current !== null) lockedBefore = current
        return verdict === 'match' ? null : current
      })
      if (!ran.done) return { ok: false, message: '内部错误：删除事务没有调用任务；没有删除任何东西' }
    } else if (verdict === 'match') {
      await this.io.remove(target)
    }
    if (verdict !== 'match') return anchorRefusalFile(name, filePath, verdict)
    await this.audit(name, 'remove_file', lockedBefore, null, `removed ${filePath}`, filePath, unitId)
    this.notifyMutation({ action: 'remove_file', name, skillDir: dir, file: target })
    return { ok: true, message: `支撑文件「${filePath}」已从「${name}」移除。`, path: target }
  }

  /**
   * v23 (ML-1): `.archive` retention. Archived skills are recoverable history,
   * but nothing bounded their growth — the curator auto-archives idle skills,
   * consolidation and manual deletes take the same path, and every snapshot
   * copies the whole `.archive` (keep-5 retention amplifies it ×6). Entries
   * older than this many days are pruned at snapshot time. Generous by
   * design: a year-old auto-archive is effectively dead recoverability.
   * Backends without the mtime probe skip pruning (no false deletes on
   * unknown age).
   */
  /**
   * 0.5.0 V1 (design §16.6-④): the retention window's READ half. Names every
   * archived entry past the window without touching it — the report path the
   * default policy uses, and the input the curator's run report carries.
   * @returns the expired entry names ([] when the backend has no mtime probe,
   *   because an unknown age must never read as expired).
   */
  /** Names currently in .archive, for target occupancy; unknown listing is null. */
  async archivedNames(): Promise<string[] | null> {
    const listed = await probeList(this.io, join(this.root, '.archive'))
    if (isUnknown(listed)) return null
    return isPresent(listed) ? listed.value.slice() : []
  }

  async expiredArchives(): Promise<string[] | null> {
    const archiveRoot = join(this.root, '.archive')
    // Three-state read (N14), the same helper every other listing uses: a
    // version-control-free listing failure is UNKNOWN, and the report must say so
    // rather than claim nothing expired.
    const listed = await probeList(this.io, archiveRoot)
    if (isUnknown(listed)) return null
    if (!isPresent(listed)) return []
    if (!this.io.mtime) return null
    const cutoff = Date.now() - ARCHIVE_RETENTION_DAYS * 86_400_000
    const expired: string[] = []
    let undated = 0
    for (const entry of listed.value) {
      // N36: a failed mtime probe is not "not expired" — the entry is RETAINED (the safe direction)
      // and the count is reported, so a broken archive cannot look like a fully swept one.
      const probe = await probeMtime(this.io, join(archiveRoot, entry))
      if (isUnknown(probe)) {
        undated += 1
        continue
      }
      if (isAbsent(probe) || probe.value > cutoff) continue
      expired.push(entry)
    }
    if (undated > 0) console.warn(`skill-store: ${undated} archived entr(ies) could not be dated (mtime probe failed); they are retained — a failed probe never expires an entry`)
    return expired
  }

  /** V4 (design §16.6): support-file char policy, resolved at the call site. */
  supportFileCharPolicy(): 'report' | 'enforce' {
    return this.limits.supportFileCharPolicy ?? DEFAULT_SUPPORT_FILE_CHAR_POLICY
  }

  /** Retention policy resolved at the call site (absent limits object = report).
   * Public so a run report can say WHICH policy produced its numbers. */
  archiveRetentionPolicy(): 'report' | 'prune' {
    return this.limits.archiveRetention ?? DEFAULT_ARCHIVE_RETENTION_POLICY
  }

  private async pruneExpiredArchives(): Promise<void> {
    // ONE listing site for both halves of retention (expiredArchives decides what
    // is expired; this only deletes what it named).
    const expired = await this.expiredArchives()
    if (expired === null) return
    for (const entry of expired) {
      const entryPath = join(this.root, '.archive', entry)
      await this.io.remove(entryPath).catch(() => {})
      console.warn(`skill-store: pruned archived skill "${entry}" (older than ${ARCHIVE_RETENTION_DAYS} days; recoverable from snapshots until they rotate)`)
    }
  }

  /**
   * Snapshot the recoverable skills state: active tree, usage/suppression
   * sidecars, `.archive/` and caller-supplied extras. `extras` are opaque
   * side files the Snapshot owner cares about (curator state); they are
   * listed in the manifest and only those names are ever read back.
   */
  async snapshotAll(reason = 'pre-mutation', extras: SnapshotExtra[] = []): Promise<string> {
    // v23 (ML-1): retention runs BEFORE the copy, so the snapshot does not
    // enshrine entries that are about to be pruned.
    // 0.5.0 V1: only the `prune` policy deletes; the default `report` names the
    // expired entries and leaves them alone (upstream's never-delete invariant,
    // and §14's "no automatic deletion"). The report reaches the operator through
    // the curator run report, not only through a warn line here.
    if (this.archiveRetentionPolicy() === 'prune') {
      await this.pruneExpiredArchives()
    } else {
      const expired = await this.expiredArchives()
      if (expired === null) {
        console.warn('skill-store: archive retention state UNKNOWN — the .archive listing could not be read (archiveRetention=report, nothing deleted)')
      } else if (expired.length > 0) {
        console.warn(`skill-store: ${expired.length} archived skill(s) past the ${ARCHIVE_RETENTION_DAYS}-day window kept (archiveRetention=report): ${expired.slice(0, 5).join(', ')}`)
      }
    }
    const backupRoot = join(this.root, '.backups')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let dest = join(backupRoot, `skills-${stamp}`)
    // Same-millisecond collision guard: two snapshots in one ms (e.g.
    // restoreLatestSnapshot's pre-rollback snapshot racing the snapshot it is
    // about to restore from) used to share one directory, and the later copy
    // overwrote the earlier manifest — a restore then read the WRONG tree
    // (rc.42-audit-adjacent, flaked the boundary snapshot/restore test).
    while (await this.io.exists(dest)) {
      dest = join(backupRoot, `skills-${stamp}-${Math.random().toString(36).slice(2, 8)}`)
    }
    try {
      const names = await listNames(this.root, this.io)
      // Parallel copies: snapshot backups touch disjoint directories, and the
      // per-path write locks never contend (P2-6). A1-18 (v18): allSettled
      // (not all) so the cleanup below cannot race a still-running copy and
      // leave a manifest-less orphan directory behind.
      // V24-20b (v24): the copy joins the destructive-movers' probe discipline
      // (archive / restore / whole-tree restore all probe `hasWriteLock`
      // before touching a skill directory). A byte-writer mid-flight used to
      // surface either as an ENOENT copy failure (rename between the list and
      // the copy) or — worse — as a TEARSORED snapshot: the copy passed
      // SKILL.md before the rename and picked up support files after it, and
      // that mixed generation was exactly what restoreLatestSnapshot would
      // roll back to. A locked skill is now SKIPPED (recorded in the
      // manifest as `skipped`, not silently absent) — a partial-but-honest
      // snapshot beats a torn one.
      const skipped: string[] = []
      const copyable: string[] = []
      for (const name of names) {
        if (await this.supportDirsUnlistable(this.dirOf(name))) {
          console.warn(`skill-store: snapshot skipped "${name}" — its support directory could not be listed; the skill is recorded as skipped in the manifest`)
          skipped.push(name)
        } else {
          copyable.push(name)
        }
      }
      const copyResults = await Promise.allSettled(copyable.map(async (name) => {
        await this.io.copy(this.dirOf(name), join(dest, name))
      }))
      const copyFailure = copyResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (copyFailure) throw copyFailure.reason
      // OPT-07 (2026-09): post-copy lock RE-PROBE. The probe above runs
      // before the copies; a byte-writer that started AFTER its skill was
      // probed but BEFORE its copy landed used to produce a torn snapshot
      // whose manifest still said `skipped: []` — restoreLatestSnapshot
      // would then roll the live tree back over that writer's landed bytes.
      // Re-probing keeps the manifest honest: any skill whose lock appeared
      // mid-copy is demoted to `skipped` (its copied bytes are suspect and
      // never referenced by a restore — restoreLatestSnapshot refuses an
      // incomplete snapshot outright, V27 G0.1). The stale directory copy
      // stays on disk but is unreachable through the manifest.
      const suspect: string[] = []
      for (const name of copyable) {
        if (await this.supportDirsUnlistable(this.dirOf(name))) suspect.push(name)
      }
      if (suspect.length > 0) {
        for (const name of suspect) {
          console.warn(`skill-store: snapshot demoted "${name}" to skipped — a write lock appeared while its copy ran; the copied bytes are suspect`)
        }
        for (const name of suspect) {
          copyable.splice(copyable.indexOf(name), 1)
        }
        skipped.push(...suspect)
      }
      // Sidecar co-snapshot: a rollback that restores the tree but leaves the
      // post-archival usage/suppression state behind would immediately let the
      // curator re-decide on stale records (rollback integrity).
      const sidecars: string[] = []
      for (const sidecar of [usageFile(this.root), suppressedFile(this.root)]) {
        if (await this.io.exists(sidecar)) {
          const name = basename(sidecar)
          await this.io.copy(sidecar, join(dest, name))
          sidecars.push(name)
        }
      }
      // Archive co-snapshot: rollback must restore what was archived at snapshot
      // time too — archived skills are the recoverable history, and a restore
      // that leaves a post-run `.archive/` behind breaks the archive invariant
      // (Hermes curator_backup backs up `.archive/` as well).
      const archiveRoot = join(this.root, '.archive')
      let hasArchive = false
      if (await this.io.exists(archiveRoot)) {
        await this.io.copy(archiveRoot, join(dest, '.archive'))
        hasArchive = true
      }
      // v29 SK-08: invalid extras fail LOUD instead of two silent wrongs — an
      // out-of-grammar name used to be dropped with no result surface (the
      // data silently skipped every rollback), and a non-string name coerced
      // through RegExp.test then threw a bare TypeError inside path.join.
      // The manifest READER already sanitizes this shape (V27 G0.4); the
      // writer now refuses it at the same boundary.
      // The scan runs through the `unknown` element boundary on purpose: the
      // runtime payload may violate the declared SnapshotExtra shape (the
      // exact defect this guard refuses).
      const extrasAsUnknown = extras as unknown as Array<{ name?: unknown } | undefined>
      const rejectedExtras = extrasAsUnknown
        .filter(extra => typeof extra?.name !== 'string' || !SNAPSHOT_EXTRA_NAME_RE.test(extra.name))
        .map(extra => JSON.stringify(extra?.name ?? extra))
      if (rejectedExtras.length > 0) {
        throw new Error(`snapshotAll: refusing invalid snapshot extras (name must match ${SNAPSHOT_EXTRA_NAME_RE.source}): ${rejectedExtras.join(', ')}`)
      }
      const validExtras = extras
      const extraNames = validExtras.map(extra => extra.name)
      const extraResults = await Promise.allSettled(validExtras.map(async (extra) => {
        await this.io.writeText(join(dest, 'extras', extra.name), extra.content)
      }))
      const extraFailure = extraResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (extraFailure) throw extraFailure.reason
      await this.io.writeText(join(dest, 'manifest.json'), JSON.stringify({
        reason,
        createdAt: new Date().toISOString(),
        skills: copyable,
        skipped,
        sidecars,
        hasArchive,
        extras: extraNames,
      }, null, 2))
      await this.retainSnapshots(5)
    } catch (error) {
      // P2-5 (v11): a mid-snapshot failure used to leave a manifest-less
      // orphan directory behind — retainSnapshots only counts listed
      // snapshots, so it was never reaped (unbounded growth on repeated
      // failures). Best-effort removal of the half-written snapshot.
      await this.io.remove(dest).catch(() => {})
      throw error
    }
    return dest
  }

  /** Read and normalize a snapshot manifest; null when the file is missing or unparsable. */
  /**
   * V26-03 (v25/v26): sanitize the manifest's `skipped` list before it can
   * reach a user-visible restore message. Entries must pass the same name
   * gate as snapshot entries (a corrupted or hand-edited manifest cannot
   * inject arbitrary text into the result), bounded to 50 entries of at most
   * 64 chars each (the name-rule maximum — real skill names always fit).
   */
  private sanitizeSkippedNames(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    const out: string[] = []
    for (const entry of raw) {
      if (typeof entry !== 'string') continue
      if (!this.safeSnapshotEntryName(entry)) continue
      out.push(entry.length > 64 ? entry.slice(0, 64) : entry)
      if (out.length >= 50) break
    }
    return out
  }

  /**
   * V27 G0.4 (core-a-01): the per-entry gate `skipped` already has. A corrupted
   * or hand-edited manifest could carry `extras: [123]`: the array check passed,
   * `SNAPSHOT_EXTRA_NAME_RE.test(123)` coerced the number to the string "123"
   * and matched, and the value then threw `TypeError` inside `path.join` — which
   * `readSnapshotExtras` reached only AFTER a whole-tree restore had committed.
   * Extras are path components under `extras/`, so they take the entry gate too;
   * bounded like `skipped` so a hostile manifest cannot grow the read set.
   */
  private sanitizeExtraNames(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    const out: string[] = []
    for (const entry of raw) {
      if (typeof entry !== 'string') continue
      if (!SNAPSHOT_EXTRA_NAME_RE.test(entry)) continue
      if (!this.safeSnapshotEntryName(entry)) continue
      out.push(entry)
      if (out.length >= 50) break
    }
    return out
  }

  async readSnapshotManifest(path: string): Promise<SnapshotManifest | null> {
    const raw = await this.io.readText(join(path, 'manifest.json'))
    if (raw === null) return null
    try {
      const manifest = JSON.parse(raw) as Partial<SnapshotManifest>
      // A1-3 (v18): `skills` is the authoritative list that drives the
      // destructive clear. A manifest without it (or with a non-array value)
      // is invalid — returning `[]` here made restore clear the whole tree and
      // report success. The caller refuses an existing-but-invalid manifest
      // before touching the live tree.
      if (!Array.isArray(manifest.skills)) return null
      return {
        reason: typeof manifest.reason === 'string' ? manifest.reason : '',
        createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : '',
        skills: manifest.skills,
        // V25-05 (v25): preserve the skipped list so the restore path can
        // surface the skills a whole-tree restore will NOT bring back.
        // V26-03 (v26): the list is SANITIZED before it can reach a
        // user-visible message — entries must pass the same name gate as
        // snapshot entries (a corrupted/hand-edited manifest cannot inject
        // arbitrary text), bounded to 50 entries × 64 chars (the name-rule
        // maximum).
        skipped: this.sanitizeSkippedNames(manifest.skipped),
        sidecars: Array.isArray(manifest.sidecars) ? manifest.sidecars : [],
        ...typeof manifest.hasArchive === 'boolean' ? { hasArchive: manifest.hasArchive } : {},
        extras: this.sanitizeExtraNames(manifest.extras),
      }
    } catch {
      return null
    }
  }

  /** Keep only the newest N snapshots (Hermes keep=5 parity); older ones are removed outright. */
  /**
   * G3/3.4: can a snapshot actually be used right now?
   *
   * The recovery messages used to promise "restore it from a snapshot" without asking whether a usable
   * snapshot exists (audit S1-01: the message promised recoverability from a chain that is five deep and
   * whose newest member held 9 of 35 skills). Three states, like every other reading here: a fragment
   * naming the usable snapshot, a fragment saying there is none, or a fragment saying the directory could
   * not be read - the caller embeds whichever it gets, so the sentence is generated by the capability.
   */
  private async snapshotRecoveryAvailability(): Promise<string> {
    const listed = await this.listSnapshots()
    if (isUnknown(listed)) {
      return '快照目录读不出来（' + listed.reason + '）'
    }
    const latest = isPresent(listed) ? listed.value[0] : undefined
    if (!latest) return '当前没有可用快照'
    return '最新快照 ' + latest.path
  }

  private async retainSnapshots(keep: number): Promise<void> {
    const listed = await this.listSnapshots()
    // N14: an UNREADABLE .backups is not "no snapshots". Pruning nothing is the
    // only safe answer there (never delete what we cannot enumerate).
    if (isUnknown(listed)) {
      console.warn(`skill-store: snapshot retention skipped — the snapshot directory could not be listed (${listed.reason})`)
      return
    }
    const snapshots = isPresent(listed) ? listed.value : []
    for (const snapshot of snapshots.slice(keep)) {
      try {
        await this.io.remove(snapshot.path)
      } catch {
        // Best-effort pruning: a failed removal must not fail the snapshot itself.
      }
    }
  }

  /** Snapshots as a THREE-state read (N14): absent = no .backups directory,
   * unknown = it exists but could not be listed (a caller must not read a
   * failed listing as "no snapshots to restore"). */
  async listSnapshots(): Promise<Probe<Array<{ path: string; createdAt: string; reason: string }>>> {
    const backupRoot = join(this.root, '.backups')
    const listed = await probeList(this.io, backupRoot)
    if (!isPresent(listed)) return listed
    const out: Array<{ path: string; createdAt: string; reason: string }> = []
    for (const name of listed.value.sort().reverse()) {
      if (!name.startsWith('skills-')) continue
      const manifest = await this.readSnapshotManifest(join(backupRoot, name))
      if (manifest === null) {
        // v23 (ML-2): a manifest-less/corrupt snapshot used to ESCAPE the
        // retention window entirely (list → skip → never reaped), and each
        // orphan is a full tree+.archive copy. Surface it with an empty
        // createdAt — the sort treats '' as oldest, so retainSnapshots evicts
        // orphans FIRST while a genuinely recent valid snapshot stays ahead.
        out.push({ path: join(backupRoot, name), createdAt: '', reason: '清单读不出来或缺失（孤儿快照）' })
        continue
      }
      out.push({ path: join(backupRoot, name), createdAt: manifest.createdAt, reason: manifest.reason })
    }
    // A1-21 (v18): the manifest's createdAt is the authoritative recency
    // (same-millisecond random-suffix names can sort wrongly by name).
    out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.path.localeCompare(a.path))
    return probePresent(out)
  }

  /**
   * Read the extras of a snapshot, restricted to the names declared in the
   * manifest — an `extras/` directory is never listed directly, so unknown
   * files cannot leak back as state on the next restore.
   */
  async readSnapshotExtras(path: string): Promise<SnapshotExtra[]> {
    const manifest = await this.readSnapshotManifest(path)
    if (manifest === null) return []
    const extras: SnapshotExtra[] = []
    for (const name of manifest.extras) {
      if (!SNAPSHOT_EXTRA_NAME_RE.test(name)) continue
      const content = await this.io.readText(join(path, 'extras', name))
      if (content !== null) extras.push({ name, content })
    }
    return extras
  }

  /**
   * Manifest-driven restore of the latest snapshot: active tree, sidecars,
   * `.archive/` and (for full-state snapshots) the extras read back by the
   * caller. `extras` are additionally written into the pre-rollback safety
   * snapshot so the rollback itself is undoable with the same state.
   */
  async restoreLatestSnapshot(extras: SnapshotExtra[] = []): Promise<SkillActionResult & { extras?: SnapshotExtra[] }> {
    const listed = await this.listSnapshots()
    // N14: a failed listing is NOT "no snapshot" — say which one happened, and
    // refuse before the pre-rollback snapshot (nothing has changed yet).
    if (isUnknown(listed)) {
      return { ok: false, message: `拒绝快照恢复：快照目录读不出来（${listed.reason}）—— 未做任何改动。` }
    }
    const latest = isPresent(listed) ? listed.value[0] : undefined
    if (!latest) return { ok: false, message: '没有可用的技能快照。' }
    // v29 SK-07: the pre-rollback snapshot is the rollback INSURANCE, not part
    // of the restore — a failure taking it (win32 AV/indexer hold on the copy,
    // ENOSPC) used to reject raw out of this method before the E-13 rollback
    // machinery could speak. Nothing has been cleared at this point, so the
    // refusal is structured and says the tree is untouched.
    let preRollbackPath: string
    try {
      preRollbackPath = await this.snapshotAll('pre-rollback', extras)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { ok: false, message: `在任何清理之前就拒绝了快照恢复：生成回滚前快照失败（${reason}）—— 活动目录树未改变。请解决快照写入失败后重试。` }
    }
    // V27 G0.4 (core-a-01): the extras read happens BEFORE the destructive
    // replace. It used to run after the commit point and outside the rollback
    // try, so a corrupt manifest (`extras: [123]`) or one real read failure
    // (EACCES/EBUSY — the seam maps only "missing" to null) threw once the tree
    // had already been replaced: the mutation event never fired (the catalog
    // kept serving the pre-restore view) and the caller was told the restore
    // failed even though it had succeeded — and retrying cleared the tree again.
    // Reading here means a bad manifest aborts before anything is cleared.
    // S1-E2: a real READ failure on the manifest/extras (transient win32 AV or
    // indexer hold) used to escape this method as a raw rejection BETWEEN the
    // two protected tries — the caller's structured SkillActionResult contract
    // broke exactly on the path the comment above claims is covered. Nothing
    // has been cleared, so the refusal is structured and retryable, matching
    // the pre-rollback posture above.
    let snapshotExtras: SnapshotExtra[]
    try {
      snapshotExtras = await this.readSnapshotExtras(latest.path)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { ok: false, message: `在任何清理之前就拒绝了快照恢复：读取快照清单或附属文件失败（${reason}）—— 活动目录树未改变。请解决读取失败后重试。` }
    }
    try {
      await this.restoreSnapshotIntoRoot(latest.path)
    } catch (error) {
      // 0.3.16 (E-13): the old shape cleared the active root and then restored
      // with NO protection — a damaged/incomplete snapshot left the tree
      // empty and the caller received a raw rejection. Roll back to the
      // pre-rollback snapshot just taken; if that fails too, name both paths
      // so the operator can rescue by hand.
      const reason = error instanceof Error ? error.message : String(error)
      try {
        await this.restoreSnapshotIntoRoot(preRollbackPath)
        return { ok: false, message: `快照恢复失败（${reason}）；活动目录树已回滚到回滚前的快照。` }
      } catch (rollbackError) {
        const rb = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        // v28 G2.5 (CORE-SK-03): both failures were PRE-CLEAR refusals
        // (manifest / completeness / live-writer gates) — the active tree is
        // byte-identical to before the attempt, so the old "Rescue manually"
        // sent operators hand-rescuing an intact library (and repeated on
        // every retry while the writer held the lock).
        if (isPreClearRefusal(reason) && isPreClearRefusal(rb)) {
          return {
            ok: false,
            message: `在任何清理之前就拒绝了快照恢复； 活动目录树未改变。\n- 目标：${reason}\n- 回滚前快照：${rb}\n请解决原因（有存活的技能写入，或快照不完整）后重试 —— 无需手动抢救。`,
          }
        }
        return { ok: false, message: `快照恢复失败（${reason}），且回滚前快照的恢复也失败（${rb}）。请手动抢救：${preRollbackPath}（回滚前）、${latest.path}（目标）。` }
      }
    }
    // Whole-tree replacement: a single synthetic event invalidates the catalog
    // regardless of how many skills the restore touched (decision C).
    this.notifyMutation({ action: 'restore', name: 'snapshot' })
    // V27 G0.1 (core-a-10): a successful restore is always COMPLETE — an
    // incomplete snapshot is refused before the clear (see
    // `restoreSnapshotIntoRoot`), so there is no "skipped but restored" message
    // to render any more: the refusal names the skills instead.
    return {
      ok: true,
      message: `已从 ${latest.path} 恢复技能目录树`,
      path: latest.path,
      ...snapshotExtras.length === 0 ? {} : { extras: snapshotExtras },
    }
  }

  /**
   * Whole-tree replacement from one snapshot path (rc.50 P2-14): every
   * NON-system entry in the active root is cleared first, then the manifest
   * drives the repopulation (skills, sidecars, `.archive`). Extracted from
   * restoreLatestSnapshot so a failed restore can roll itself back (E-13).
   */
  private async restoreSnapshotIntoRoot(snapshotPath: string): Promise<void> {
    // A1-3 (v18): read and validate the manifest BEFORE clearing anything.
    // The old order cleared the active tree first, then treated an
    // unreadable/skills-less manifest as "restore nothing" and still reported
    // ok:true. A manifest.json that exists but cannot be parsed is corruption,
    // not a legacy snapshot, and must refuse before the destructive clear.
    const manifest = await this.readSnapshotManifest(snapshotPath)
    if (manifest === null) {
      // A1-16 + P2-3 (v19): the refusal must precede EVERY destructive step.
      // The v18 shape cleared the active tree first and only then rejected a
      // manifest-less snapshot, so a manifest lost between listSnapshots and
      // this restore emptied the live library before failing.
      throw new Error(await this.io.exists(join(snapshotPath, 'manifest.json'))
        ? `snapshot ${snapshotPath} has an unreadable manifest.json; refusing to clear the active tree`
        : `snapshot ${snapshotPath} has no readable manifest.json; refusing to restore`)
    }
    {
      // A1-4 (v18): every manifest-declared name is a path component copied
      // into the skills root — reject traversal/absolute shapes up front.
      for (const name of [...manifest.skills, ...manifest.sidecars]) {
        if (!this.safeSnapshotEntryName(name)) {
          throw new Error(`snapshot ${snapshotPath} declares an unsafe entry name ${JSON.stringify(name)}; refusing to restore`)
        }
      }
      // V27 G0.1 (core-a-10): a snapshot that skipped skills is INCOMPLETE and
      // must never authorize the destructive clear. `snapshotAll` records every
      // skill it could not copy (a live byte-writer held its write lock) in
      // `manifest.skipped`, so such a snapshot holds everything EXCEPT those
      // skills; restoring it clears the live root and copies back only
      // `manifest.skills`, which DELETES the skipped skills from the live
      // library while reporting ok:true (v25 only added a message note). With
      // every skill locked the snapshot is empty and the whole library is wiped.
      // v24-20b (skip instead of tear) and v19 P1-2 (allow a genuinely empty
      // tree) are both right on their own; `skipped` was simply never consulted
      // for completeness. Restoring is therefore limited to COMPLETE snapshots:
      // the pre-rollback snapshot keeps the current tree, and the refusal names
      // the skills so the operator can retry once the writer has finished.
      if (manifest.skipped.length > 0) {
        throw new Error(
          `snapshot ${snapshotPath} is incomplete: ${manifest.skipped.length} skill(s) were skipped when it was taken `
          + `(a live writer held their write lock: ${manifest.skipped.join(', ')}); restoring it would clear the active tree `
          + 'without bringing them back — let the writer finish and take a fresh snapshot, then restore that one',
        )
      }
      // A1-3 (v18): a manifest that declares no skills while the snapshot
      // directory contains UNDECLARED entries is inconsistent (a corrupted/
      // truncated manifest); clearing to an empty tree would lose the live
      // library. P1-2 (v19): the allowed set is derived from the manifest's own
      // declaration — `snapshotAll` co-copies the usage/suppression sidecars
      // into the snapshot root and lists them in `manifest.sidecars`, so the
      // v18 hardcoded three-name list rejected every healthy empty-tree
      // snapshot and killed the rollback channel.
      if (manifest.skills.length === 0) {
        const snapshotEntries = await this.io.list(snapshotPath)
        const declared = new Set<string>(['manifest.json', 'extras', '.archive', ...manifest.skills, ...manifest.sidecars])
        const undeclared = snapshotEntries.filter(entry => !declared.has(entry))
        if (undeclared.length > 0) {
          throw new Error(`snapshot ${snapshotPath} declares no skills but contains undeclared entries (${undeclared.join(', ')}); refusing to clear the active tree`)
        }
      }
    }
    let rootEntries: string[]
    try {
      rootEntries = await this.io.list(this.root)
    } catch (error) {
      // S1.4 (v37 P1-5): a failed root listing must NOT read as "no entries".
      // The clear loop below would silently degrade into a merge (post-snapshot
      // skills survive), the live-writer refusal right after it would never run,
      // and the caller was still told ok:true.
      throw new Error(`snapshot restore refused: the skill root could not be listed (${error instanceof Error ? error.message : String(error)}) — nothing was changed`)
    }
    // A1-7 (v18): the snapshot channel has no writer probe in v17. Refuse while
    // a skill writer is active; dead lock residue is swept first so a crashed
    // writer does not block recovery. Root-level sidecar locks are checked the
    // same way (a live `.usage.json.lock` must not be deleted by the clear).
    for (const entry of rootEntries) {
      if (entry === '.archive' || entry === '.backups' || entry === '.mutations.json' || entry === '.curator-suppressed.json' || entry === HISTORY_DIR) continue
      const dir = join(this.root, entry)
      if (await this.io.exists(join(dir, 'SKILL.md'))) {
        if (await this.supportDirsUnlistable(dir)) {
          throw new Error(`snapshot restore refused: skill "${entry}" is being written (write lock present); retry once the write completes`)
        }
      }
    }
    // A1-19 (v18): a snapshot that does not carry `.curator-suppressed.json`
    // must roll the live one away too (otherwise a post-snapshot suppression
    // survives as a ghost). The manifest branch copies it back when present.
    const restoresSuppressed = manifest.sidecars.includes('.curator-suppressed.json')
    // F-316 (0.3.25): only the system directories and the durable sidecars are
    // survived by a snapshot restore. A dot-entry that appeared AFTER the
    // snapshot (e.g. a fresh `.usage.json`) used to be kept by the blanket
    // `startsWith('.')` skip, leaving a ghost record that disagrees with the
    // restored tree (E-15 self-heal could converge, but the intermediate state
    // is observable). Usage is derived data — the next curator run seeds
    // empty records — so it is dropped with the tree; the mutation audit is
    // real history and stays. `.curator-suppressed.json` is a co-snapshotted
    // sidecar and comes back with the snapshot (a later suppression made after
    // the snapshot is rolled back with it — the correct rollback semantics).
    // A1-7 (v18): lock files are protocol state, never snapshot content; the
    // clear skips them (a live one was refused above, a dead one swept).
    // G3/3.1 (audit 3.1 + 1.6): the clear set is DERIVED and it is REPORTED before anything is removed.
    // Until this guard the loop walked the LIVE root and removed whatever the snapshot did not declare,
    // so "what will this restore delete" was stated nowhere; the only protection was the completeness
    // gate above. `doomed` is the derived difference: live entries minus the survival set minus every
    // name the manifest declares. It is warned about here and then used as the loop itself.
    const declared = new Set<string>([...manifest.skills, ...manifest.sidecars])
    const doomed = rootEntries.filter((entry) => {
      if (entry === '.archive' || entry === '.backups' || entry === '.mutations.json') return false
      if (entry === HISTORY_DIR) return false
      if (entry === '.curator-suppressed.json' && restoresSuppressed) return false
      return !declared.has(entry)
    })
    if (doomed.length > 0) {
      console.warn('skill-store: snapshot restore will delete ' + String(doomed.length) + ' live entr(y|ies) the snapshot does not declare: ' + doomed.join(', '))
    }
    for (const entry of doomed) {
      await this.io.remove(join(this.root, entry))
    }
    // P2-3 (v19): `manifest` is non-null here — the refusal above precedes the
    // clear, so this branch cannot leave an emptied tree behind.
    for (const name of manifest.skills) {
      await this.io.copy(join(snapshotPath, name), join(this.root, name))
    }
    for (const sidecar of manifest.sidecars) {
      await this.io.copy(join(snapshotPath, sidecar), join(this.root, sidecar))
    }
    {
      // Archive is part of the whole-state rollback: a snapshot that carried
      // `.archive/` replaces the current one; a snapshot with no archive
      // means the archive content post-dates it, so it is rolled away too
      // (the pre-rollback snapshot above preserved it). Legacy manifests
      // without the field leave `.archive` untouched.
      const archiveRoot = join(this.root, '.archive')
      if (manifest.hasArchive === true) {
        await this.io.remove(archiveRoot)
        await this.io.copy(join(snapshotPath, '.archive'), archiveRoot)
      } else if (manifest.hasArchive === false) {
        await this.io.remove(archiveRoot)
      }
    }
    // P3 (v17): the snapshot channel has the same stranded-lock hazard as
    // restoreFromArchive (v16 fixed only that entry point) — a writer lock
    // that rode into the snapshot rides back into the live root here, where
    // its live-pid body structurally closes the writers' self-heal. Sweep
    // every restored skill directory best-effort.
    for (const entry of await this.io.list(this.root)) {
      if (entry.startsWith('.')) continue
    }
  }
}

/** The emit surface the helper needs — structurally the platform context's
 * `emit`, so core states the contract without importing the platform type. */
export interface SkillMutationSink {
  emit: (type: 'evolution/skill-mutated', event: EvolutionSkillMutatedEvent) => unknown
}

/** V41 P2-26 (0.3.75): the ONE SkillLibrary construction point.
 *
 * Eleven call sites used to re-derive the root and hand-roll the
 * `evolution/skill-mutated` arrow (the catalog invalidates its cache on that
 * exact string, so a second spelling is a silent divergence), and each one
 * re-decided its own limits. `config` stays the RAW family config: resolving
 * an empty `root` to the family default is `resolveSkillsRoot`'s policy, not
 * a per-caller detail. */
export interface NewSkillLibraryOptions {
  /** Raw family config; only `root` is read, through resolveSkillsRoot. */
  config?: { root?: string | undefined } | undefined
  io: EvolutionIoLike
  limits?: SkillLimits | undefined
  /** Supplying it wires the mutation event HERE — never at the call site. */
  ctx?: SkillMutationSink | undefined
  transact?: typeof transactIo | undefined
  threatExemptLabels?: readonly string[] | undefined
  /** G1/1.1: WHO writes through this library. Required: no call site can omit it. */
  authority: WriteAuthority
}

export function newSkillLibrary(options: NewSkillLibraryOptions): SkillLibrary {
  const { config, io, limits, ctx, transact, threatExemptLabels, authority } = options
  return new SkillLibrary(
    resolveSkillsRoot(config ?? {}),
    io,
    limits,
    ctx ? (event) => { ctx.emit('evolution/skill-mutated', event) } : undefined,
    transact,
    // Copied once, here: the library holds the array for its lifetime and must
    // not alias a config object the caller still owns.
    [...(threatExemptLabels ?? [])],
    authority,
  )
}

export {
  DEFAULT_SKILL_LIMITS,
  DEFAULT_CITATION_POLICY,
  DEFAULT_REFERENCE_REWRITE_POLICY,
  DEFAULT_ARCHIVE_RETENTION_POLICY,
  DEFAULT_SUPPORT_FILE_CHAR_POLICY,
  POLICY_STAGE_DEFAULTS,
  policyStageLimits,
} from './limits.ts'
export type {
  SkillLimits,
  CitationPolicy,
  ReferenceRewritePolicy,
  ArchiveRetentionPolicy,
  SupportFileCharPolicy,
  PolicyStageFields,
} from './limits.ts'
export { authoringFeedback, ensureSkillFrontmatter, frontmatterBlock, frontmatterCatalogInvalid, normalizeFrontmatter, parseFrontmatter, relatedSkillNames, validateFrontmatter, yamlPlainScalarNeedsQuotes } from './frontmatter.ts'
export type { FrontmatterRepair } from './frontmatter.ts'
export type { AuthoringFeedback, Frontmatter, FrontmatterNormalizeResult, FrontmatterRead, PlatformStringSplit } from './frontmatter.ts'
