/**
 * Skill library management for the self-evolution plugin.
 *
 * Skills live under `$DSH_HOME/skills` (`~/.dsh/skills` by default), matching
 * the default dsh skill-filesystem user root. The plugin only manages skills
 * it created unless a `.hermes-managed` marker opts a skill in. Archival is a
 * move to `.archive/` — never a hard delete.
 */

import { basename, join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { scanContentThreats, type ScanOptions } from './threats.ts'
import { LOCK_BODY_RE, LOCK_SUFFIX, isProcessAlive, nodeEvolutionIo, parseLockBody, transactIo, type EvolutionIoLike } from './io.ts'
import { evolutionRoot } from './state-store.ts'
import { makeSerialQueue } from './serial.ts'
import { contentHash, loadMutations, recordMutation, type MutationRecord } from './mutations.ts'
import { suppressedFile, usageFile } from './usage.ts'
import { assessStructureHealth, DEFAULT_HEALTH_THRESHOLDS, type SkillHealthAssessment, type SkillHealthThresholds } from './skill-health.ts'
import { AUTHORING_DESCRIPTION_BAR, MAX_SKILL_NAME_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_SKILL_CONTENT_CHARS, MAX_SKILL_FILE_BYTES, SKILL_NAME_RE, SUPPORT_DIRS } from './constants.ts'

/** 0.3.16 (S1.13, T-6): the pointer-line prefix written into a body when a
 * section is moved to references/ — single literal, both restructure and
 * append-mode consolidation emit the same discoverability line. */
const POINTER_LINE_PREFIX = '> 详见 references/'
import type { EvolutionSkillMutatedEvent } from './events.ts'

export interface SkillLimits {
  maxNameLength: number
  maxDescriptionLength: number
  maxSkillContentChars: number
  maxSkillFileBytes: number
}

export const DEFAULT_SKILL_LIMITS: SkillLimits = {
  maxNameLength: MAX_SKILL_NAME_LENGTH,
  maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
  maxSkillContentChars: MAX_SKILL_CONTENT_CHARS,
  maxSkillFileBytes: MAX_SKILL_FILE_BYTES,
}

export interface SkillSummary {
  name: string
  description: string
  path: string
  protectedBy: string | null
  /** A1-17 (v18): the marker probe itself failed (EACCES/EIO), so "no marker"
   * cannot be told apart from "directory unreadable". Consumers must treat this
   * as protected, never as unprotected. */
  protectionUnknown: boolean
  managed: boolean
  /** E-11 (v18): the frontmatter `whenToUse` routing hint, published so the
   * platform catalog keeps it while this provider shadows the upstream
   * filesystem provider. Absent when the frontmatter has none. */
  whenToUse?: string
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
 * `string | undefined` still assignable under exactOptionalPropertyTypes. */
export function resolveSkillsRoot(config: { root?: string | undefined } = {}): string {
  return (config.root ?? '').trim() || skillsRoot()
}

/** E-7 (v18): every family row reads ONE root key. `root` is canonical;
 * `skillsRoot` is a deprecated alias honoured only while `root` is empty (so a
 * deployment that sets both keeps the canonical one) and removed after 0.3.65.
 * Callers log their own deprecation warning.
 * @param config - the raw plugin config, carrying `root` and/or `skillsRoot`.
 * @returns the effective root (empty when neither key is set) and whether the
 * deprecated alias supplied it.
 */
export function resolveRootConfig(
  config: { root?: string | undefined; skillsRoot?: string | undefined } = {},
): { root: string; usedDeprecatedAlias: boolean } {
  const root = (config.root ?? '').trim()
  if (root !== '') return { root, usedDeprecatedAlias: false }
  const alias = (config.skillsRoot ?? '').trim()
  return alias === '' ? { root: '', usedDeprecatedAlias: false } : { root: alias, usedDeprecatedAlias: true }
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

/** F-17 (v18): the root-level lock files a DESTRUCTIVE MOVER must treat as an
 * active writer (skill body + the two marker writers). Single source with
 * `markerEntryName`/`LOCK_SUFFIX` so a renamed marker cannot silently drop out
 * of the ghost-writer probe. */
const MARKER_LOCK_NAMES: readonly string[] = [
  `SKILL.md${LOCK_SUFFIX}`,
  `.pinned${LOCK_SUFFIX}`,
  `.hermes-managed${LOCK_SUFFIX}`,
]

/** v23 (ML-1): `.archive` retention window (see pruneExpiredArchives). */
const ARCHIVE_RETENTION_DAYS = 365

function markerPath(dir: string, marker: 'bundled' | 'hub-installed' | 'pinned' | 'hermes-managed'): string {
  return join(dir, markerEntryName(marker))
}

export interface Frontmatter {
  name?: string
  description?: string
  [key: string]: unknown
}

/**
 * Shared frontmatter block detection (P3-3 single owner): opening line `---`
 * and closing line exactly `---` (both trimmed). Used by `parseFrontmatter`,
 * `frontmatterYamlUnsafeValues` and `normalizeFrontmatter` so the three can
 * never disagree about where the block ends (the loose `indexOf('\n---')`
 * form matched `\n----` and was replaced by this strict line rule).
 */
export function frontmatterBlock(content: string): { block: string; lines: string[]; end: number; nl: string } | null {
  if (!content.trimStart().startsWith('---')) return null
  const nl = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(nl)
  if ((lines[0] ?? '').trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    if (line.trim() === '---') { end = i; break }
  }
  if (end < 0) return null
  return { block: lines.slice(1, end).join(nl), lines, end, nl }
}

export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } | null {
  const found = frontmatterBlock(content)
  if (!found) return null
  const body = found.lines.slice(found.end + 1).join(found.nl).trim()
  if (!body) return null
  const frontmatter: Frontmatter = {}
  for (const line of found.block.split(found.nl)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match) {
      const [, key, value] = match
      if (key && value !== undefined) frontmatter[key] = value.trim().replace(/^["']|["']$/g, '')
    }
  }
  return { frontmatter, body }
}

/** YAML plain-scalar hazards that make an UNQUOTED frontmatter value
 * unloadable to the platform catalog (strict YAML parser): `: ` (mapping
 * separator), ` #` (comment start), a trailing `:` (a mapping marker),
 * or a leading YAML indicator. The evolution `parseFrontmatter` is
 * deliberately lenient, so violations silently split family-visibility from
 * platform-visibility (0.3.11 inkos-harness case: the description carried
 * "…: " and the catalog dropped the whole skill). Already-quoted values and
 * well-formed flow collections (`[a, b]` / `{a: b}`) are considered safe.
 * 0.3.16 (E-47): null/bool/number-shaped plain scalars are flagged too — they
 * parse as booleans/numbers on the platform while the family keeps the string
 * (a `description: true` split-brain).
 * This rule is only the FAST PATH — the write path re-verifies every rewrite
 * with the real YAML parser (see normalizeFrontmatter), so an incomplete
 * approximation can never corrupt a multiline flow value (P3-4). */
export function yamlPlainScalarNeedsQuotes(value: string): boolean {
  if (value.length === 0) return false
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return false
  if (/^\[.*\]$/.test(value) || /^\{.*\}$/.test(value)) return false
  if (value.includes(': ')) return true
  if (value.includes(' #')) return true
  if (value.endsWith(':')) return true
  if (/^(?:null|true|false|~|[-+]?\d+(?:\.\d+)?)$/i.test(value)) return true
  if (/^[-?:,[\]{}#&*!|>'\"%@`\s]/.test(value)) return true
  return false
}

/** Raw-line scan of the frontmatter block: entries whose UNQUOTED value is
 * YAML-unsafe for the strict platform catalog. Operates on the ORIGINAL line
 * value (quotes included), so a value already wrapped by
 * `normalizeFrontmatter` is never re-flagged — one source with the write
 * path. Single-line entries only; lines with embedded line breaks skip. */
export function frontmatterYamlUnsafeValues(content: string): Array<{ key: string; value: string }> {
  const found: Array<{ key: string; value: string }> = []
  const block = frontmatterBlock(content)
  if (!block) return found
  for (const line of block.block.split(block.nl)) {
    if (line.includes('\n') || line.includes('\r')) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    const value = (match[2] ?? '').trim()
    if (key === undefined) continue
    if (yamlPlainScalarNeedsQuotes(value)) found.push({ key, value })
  }
  return found
}

export interface FrontmatterNormalizeResult {
  content: string
  changed: boolean
  /** Frontmatter keys whose values were auto-quoted. */
  fields: string[]
  /** Values that cannot be auto-quoted safely (control characters, or a
   * rewrite that failed the real-parser verification — a multiline flow
   * collection line etc. is left untouched and reported here, so the write
   * path rejects instead of silently damaging a value; 0.3.14). */
  issues: string[]
}

/**
 * Normalize a SKILL.md frontmatter block into catalog-loadable YAML: values
 * that YAML forbids unquoted get quotes — double quotes normally, single
 * quotes (with `''` doubling) when the value contains `"` or `\` (both legal
 * unescaped inside single-quoted YAML). Idempotent; only single-line
 * `key: value` entries are touched; body text is never modified; line-ending
 * style is preserved. **Every rewrite is re-verified with the real YAML
 * parser** (js-yaml — the same parser the platform catalog uses): if the
 * rewritten block no longer parses, or a rewritten value's parsed content
 * differs from the original, the rewrite is rolled back and reported in
 * `issues` (fail-loud, never a silent value corruption — P3-4).
 *
 * V10-02 (P2-3): the rewrite decision is PER LINE — each entry parses its own
 * value, so a duplicated key can never route one entry's unsafe value into a
 * different line's rewrite (the old key→Map lookup rewrote the FIRST (safe)
 * line with the SECOND line's quoted value, and the last-wins YAML reader
 * masked the damage). A duplicated key is itself invalid input and is
 * reported in `issues` (the write path refuses) instead of being rewritten.
 */
export function normalizeFrontmatter(content: string): FrontmatterNormalizeResult {
  const block = frontmatterBlock(content)
  if (!block) return { content, changed: false, fields: [], issues: [] }
  const { lines, end, nl } = block
  const fields: string[] = []
  const issues: string[] = []
  // Detection shares the predicate with the audit side
  // (frontmatterYamlUnsafeValues): normalize and catalog-invalid detection
  // can never disagree.
  const seen = new Set<string>()
  const originalValues = new Map<string, string>()
  let changed = false
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    if (key === undefined) continue
    // V10-02 (P2-3): parse THIS line's own value (quotes included) — never a
    // same-key value from another line.
    const value = (match[2] ?? '').trim()
    if (seen.has(key)) {
      issues.push(`${key}: duplicate frontmatter key — remove the repeated entry and retry`)
      continue
    }
    seen.add(key)
    if (!yamlPlainScalarNeedsQuotes(value)) continue
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
      issues.push(`${key}: value contains control characters — clean them manually`)
      continue
    }
    // 0.3.11 fix: single-quote fallback so a `"`/`\` value stays fixable
    // through the write path (no catch-22 on legacy descriptions).
    const quoted = value.includes('"') || value.includes('\\')
      ? `'${value.replace(/'/g, "''")}'`
      : `"${value}"`
    lines[i] = `${key}: ${quoted}`
    originalValues.set(key, value)
    fields.push(key)
    changed = true
  }
  // V10-02 (P2-3): any issue (duplicate key, control characters) refuses the
  // whole rewrite — the write path rejects instead of shipping a partial fix.
  if (issues.length > 0) return { content, changed: false, fields: [], issues }
  if (!changed) return { content, changed: false, fields: [], issues }
  // 0.3.14: verify the rewritten block with the real parser — the fast-path
  // rule can mis-detect a multiline flow collection (`[a,` + continuation)
  // or any shape the plain-scalar approximation does not know. A failure must
  // roll back, never ship a value mutation.
  const rewrittenBlock = lines.slice(1, end).join(nl)
  try {
    const parsed = loadYaml(rewrittenBlock) as Record<string, unknown>
    for (const key of fields) {
      if (String(parsed[key]) !== originalValues.get(key)) {
        throw new Error(`rewritten value for ${key} differs from the original`)
      }
    }
    return { content: lines.join(nl), changed: true, fields, issues }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      content,
      changed: false,
      fields: [],
      issues: [`frontmatter rewrite verification failed (${reason}) — quoting skipped; wrap this value manually`],
    }
  }
}

/**
 * Skill names referenced by a SKILL.md's `related_skills` frontmatter
 * (B-line G3, rc.44): the single parsing source for the quality references
 * factor and the learning-graph edges. The DSH frontmatter parser keeps the
 * YAML value as a string (`"[a, b]"`), so names are scanned out of it; each
 * must satisfy the skill-name shape and the referencing skill itself is
 * excluded. Pure and deduplicated.
 */
export function relatedSkillNames(content: string, exclude?: string): string[] {
  const parsed = parseFrontmatter(content)
  if (!parsed) return []
  const raw = parsed.frontmatter['related_skills']
  if (typeof raw !== 'string') return []
  const names = new Set<string>()
  // F-321 (0.3.25): the old bare `[a-z0-9][a-z0-9-]*` scan matched an inner
  // fragment of a CamelCase word — `MySkill` produced the junk token `y` (and
  // would match `kill` in `Skill`-suffixed names), which then fed the quality
  // references factor and learning-graph edges. A name token is only a real
  // reference when it is delimited (no letter/digit/hyphen/underscore on
  // either side), so a camel/underscored word is skipped wholesale instead of
  // leaking fragments.
  for (const match of Array.from(raw.matchAll(/(?<![A-Za-z0-9_-])[a-z0-9][a-z0-9-]*(?![A-Za-z0-9_-])/g))) {
    const target = match[0]
    if (target && SKILL_NAME_RE.test(target) && target !== exclude) names.add(target)
  }
  return [...names]
}

export function validateFrontmatter(content: string, expectedName?: string, limits: SkillLimits = DEFAULT_SKILL_LIMITS): string | null {
  const parsed = parseFrontmatter(content)
  if (!parsed) return 'SKILL.md must start and end with YAML frontmatter and include a body.'
  if (!parsed.frontmatter.name) return 'Frontmatter must include a name field.'
  // C-12 (v10 audit): single-source the name shape — the inline copy of
  // SKILL_NAME_RE could silently drift from constants.ts.
  if (!SKILL_NAME_RE.test(parsed.frontmatter.name)) return `Invalid skill name "${parsed.frontmatter.name}" — use lowercase letters, digits, and hyphens.`
  if (parsed.frontmatter.name.length > limits.maxNameLength) return `Skill name exceeds ${limits.maxNameLength} characters.`
  if (expectedName && parsed.frontmatter.name !== expectedName) return `Frontmatter name "${parsed.frontmatter.name}" does not match target skill "${expectedName}".`
  if (!parsed.frontmatter.description) return 'Frontmatter must include a description field.'
  const description = parsed.frontmatter.description
  if (description.length > limits.maxDescriptionLength) return `Description exceeds ${limits.maxDescriptionLength} characters.`
  if (content.length > limits.maxSkillContentChars) {
    return `SKILL.md content exceeds ${limits.maxSkillContentChars} characters. ` +
      'Consider splitting into a smaller SKILL.md with supporting files.'
  }
  return null
}

/** Hermes authoring quality bar for descriptions — see constants.ts
 * (0.3.16 T-4 moved the single source there; the public re-export sits behind
 * the package root, which re-exports constants anyway). */

export interface AuthoringFeedback {
  /** Frontmatter description length in characters (0 when absent). */
  descriptionChars: number
  /** Whether the description exceeds the authoring bar (60) while still passing the platform limit. */
  over60: boolean
  /** Whether the description contains a colon (the standard requires double-quote wrapping). */
  hasColon: boolean
  /** Advice lines appended to mutation success messages. */
  lines: string[]
}

/**
 * Advisory authoring feedback (P0): evaluate frontmatter against the
 * authoring bar WITHOUT changing platform validation semantics. The bar is
 * the quality target, `validateFrontmatter`'s limits are the compatibility
 * floor, and this bridge layer tells the model when its text would be
 * truncated or route-poor instead of silently shipping it.
 */
export function authoringFeedback(frontmatter: Frontmatter): AuthoringFeedback {
  const description = frontmatter.description ?? ''
  const over60 = description.length > AUTHORING_DESCRIPTION_BAR
  const hasColon = description.includes(':')
  const lines: string[] = []
  lines.push(over60
    ? `Description is ${description.length}/60 characters — exceeds the 60-char authoring bar (Hermes standard; the catalog truncates at the configured platform cap).`
    : `Description ${description.length}/60 characters — within the authoring bar.`)
  if (hasColon) lines.push('Description contains a colon — wrap the whole value in double quotes.')
  return { descriptionChars: description.length, over60, hasColon, lines }
}

/** A1-15 (v18) / P2-2 (v19): the io layer marks an error `committed: true` when
 * the rename landed and only the directory fsync failed. Every single-file
 * writer must treat that as "written, durability unconfirmed" — never as a
 * plain failure (which a caller would retry, or a two-phase caller roll back). */
function isCommittedOnly(error: unknown): boolean {
  return (error as { committed?: unknown } | undefined)?.committed === true
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

function validateSupportPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.includes('..')) return 'Path traversal is not allowed.'
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0 || !SUPPORT_DIRS.includes(parts[0] as typeof SUPPORT_DIRS[number])) {
    return `file_path must be under one of: ${SUPPORT_DIRS.join(', ')}.`
  }
  if (parts.length < 2) return 'Provide a file name, not just a directory.'
  for (const part of parts.slice(1)) {
    if (!SUPPORT_FILE_NAME_RE.test(part)) {
      return `Unsupported file name "${part}" — use lowercase letters, digits, dots, hyphens, and underscores (leading letter or digit).`
    }
    // P2-1 (v17): the `.lock` suffix is RESERVED for the io writer-lock
    // protocol (`<file>.lock` lives next to its file). A user support file
    // named `*.lock` would be indistinguishable from a writer lock for the
    // archive/restore probes and could be swept as residue by
    // deleteStrandedLocks.
    if (part.toLowerCase().endsWith(LOCK_SUFFIX)) {
      return `Unsupported file name "${part}" — the .lock suffix is reserved for the writer-lock protocol.`
    }
    // A1-1 (v18): `.corrupt` and `.tmp` are the io layer's protocol artifacts
    // (quarantine copy / durable-write tmp). A user support file with either
    // suffix was eligible for sweepStaleTmps deletion; reserve them too.
    if (part.toLowerCase().endsWith('.corrupt') || part.toLowerCase().endsWith('.tmp')) {
      return `Unsupported file name "${part}" — the .corrupt/.tmp suffixes are reserved for the state/IO protocols.`
    }
    const stem = part.split('.')[0]?.toLowerCase() ?? ''
    if (WIN32_RESERVED_DEVICE_NAMES.has(stem)) {
      return `Unsupported file name "${part}" — a Windows reserved device name.`
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
function fuzzyIndexOf(content: string, pattern: string, from = 0): [number, number] | null {
  const isSpace = (char: string | undefined) => char !== undefined && /[ \t]/.test(char)
  const escaped = (char: string | undefined): string | null => {
    if (char === 'n') return '\n'
    if (char === 't') return '\t'
    if (char === 'r') return '\r'
    return null
  }
  for (let start = from; start < content.length; start += 1) {
    let contentIndex = start
    let patternIndex = 0
    while (patternIndex < pattern.length && contentIndex < content.length) {
      const patternChar = pattern[patternIndex]
      const contentChar = content[contentIndex]
      if (isSpace(patternChar)) {
        // A pattern whitespace run consumes its full run plus any content run
        // (even a shorter or empty one) before matching the next non-space.
        while (patternIndex < pattern.length && isSpace(pattern[patternIndex])) patternIndex += 1
        while (contentIndex < content.length && isSpace(content[contentIndex])) contentIndex += 1
        continue
      }
      const escapedChar = patternChar === '\\' ? escaped(pattern[patternIndex + 1]) : null
      if (escapedChar !== null && contentChar === escapedChar) {
        patternIndex += 2
        contentIndex += 1
        continue
      }
      if (patternChar === contentChar) {
        contentIndex += 1
        patternIndex += 1
        continue
      }
      break
    }
    if (patternIndex === pattern.length) return [start, contentIndex]
  }
  return null
}

/** V6-17 (0.3.37): the fuzzy-patch scan is O(n·m) with no input bound; a
 * non-exact anchor past these budgets would block the event loop (measured
 * ~6s at 20k×20k). Exact matches go through the fast `includes` path and stay
 * allowed regardless of size. */
const FUZZY_MAX_PATTERN_CHARS = 4096
const FUZZY_MAX_WORK = 8_000_000

/** Trim leading whitespace of the first line and trailing whitespace of the last line. */
function trimPatternBoundaries(pattern: string): string {
  const from = pattern.search(/\S/)
  const trimmed = from < 0 ? pattern : pattern.slice(from)
  const trailing = trimmed.search(/\s+$/)
  return trailing < 0 ? trimmed : trimmed.slice(0, trailing)
}

/** Replace only the fuzzy-matched span, preserving all surrounding bytes.
 * V7-11 (0.3.44): the replaceAll loop accumulates the per-scan cost — the
 * single-scan budget at the caller only bounded ONE fuzzyIndexOf, while an
 * unbounded number of matches × O(n·m) each could still stall the loop.
 * When the accumulated cost exceeds the budget the whole replace fails
 * (null) instead of partially applying an arbitrary prefix. */
function fuzzyReplace(content: string, oldString: string, newString: string, replaceAll: boolean): string | null {
  let current = content
  let scanFrom = 0
  let totalWork = 0
  for (;;) {
    totalWork += current.length * oldString.length
    if (totalWork > FUZZY_MAX_WORK) return null
    const match = fuzzyIndexOf(current, oldString, scanFrom)
    if (match === null) return current
    const [start, end] = match
    const next = current.slice(0, start) + newString + current.slice(end)
    if (!replaceAll) return next
    current = next
    // Resume scanning after the inserted span: a self-containing newString must
    // not be re-matched (mirrors String.replaceAll and guarantees termination).
    scanFrom = start + newString.length
  }
}

function fuzzyPatch(content: string, oldString: string, newString: string, replaceAll = false): string | null {
  // An empty oldString would `includes('')` trivially and splice newString
  // between every character; refuse it at the boundary (P0-5).
  if (oldString === '') return null
  if (content.includes(oldString)) {
    // 0.3.16 (E-2): a STRING replacement expands $&/$`/$'/$$ special
    // sequences even in the exact-match fast path — a model writing a shell
    // replacement (`100$'`) silently corrupted the file, and the fuzzy path
    // (string concat, literal) disagreed with the fast path. The replacement
    // function returns the newString verbatim; the replaceAll branch's
    // split/join is already literal.
    return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, () => newString)
  }
  const boundary = trimPatternBoundaries(oldString)
  // A whitespace-only pattern has no non-whitespace footprint; matching it
  // would hit an empty span and splice content without consuming anything.
  if (boundary === '') return null
  // Stage 1: boundary trim — the model often cites a line with its leading
  // indent (or a trailing space); trimming only the pattern's first/last line
  // keeps the replacement span on the real text without touching other bytes.
  if (boundary !== oldString) {
    if (fuzzyIndexOf(content, boundary) !== null) {
      const patched = fuzzyReplace(content, boundary, newString, replaceAll)
      // F-317: patched === content is an IDENTITY replacement (the effective
      // old/new text are equal), NOT "no match". Return the original so the
      // caller's noop judgment (patch()) reports it as unchanged — returning
      // null here made patch() say "Could not find old_string" for a patch
      // that was actually a no-op. `null` remains exclusively "no match".
      return patched
    }
  }
  // Stage 2: whitespace-plus-escape tolerance (pattern `\n`/`\t`/`\r` literals
  // match real characters, runs match runs); replacement lands on the span
  // only, so file indentation/formatting survives.
  if (fuzzyIndexOf(content, oldString) !== null) {
    const patched = fuzzyReplace(content, oldString, newString, replaceAll)
    return patched
  }
  return null
}

/** Deterministic section-extraction plan facts; the caller owns the IO and the append semantics. */
interface PlannedRestructureSection {
  rel: string
  heading: string
  text: string
}

/** Planned section extraction (pure; no IO): new body + extracted section texts. */
type RestructurePlan = { error: string } | { body: string; sections: PlannedRestructureSection[] }

/**
 * Support-directory references in a markdown body (009 kernel): `references/…`,
 * `templates/…`, `scripts/…`, `assets/…` relative links — any extension and
 * nested paths (v7 audit P3-1: `.md`-only matching missed `scripts/run.sh` and
 * `references/sub/x.md`, both of which dangle just like a `.md` link once the
 * source package is archived). Pure — who checks them and what the verdict is
 * belongs to the caller's context (a moved/appended body whose references
 * travel with an archived source is a dangling link; a restructure pointer is
 * a fresh link to a file written in the same plan). `..` traversal is a
 * different defect class (path validation owns it) and is not a support link.
 */
function supportRefs(content: string): string[] {
  const refs: string[] = []
  for (const match of content.matchAll(/\b(?:references|templates|scripts|assets)\/[A-Za-z0-9._/-]+/g)) {
    const ref = match[0]
    if (ref.includes('..')) continue
    refs.push(ref)
  }
  return refs
}

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
}

/**
 * Deterministic tree-change plan (009 kernel): a batch of content writes with
 * one commit point. The kernel owns validation order, pre-read versions,
 * rollback bytes, audit and the mutation event — mutators compose plans, they
 * never implement two-phase commit themselves.
 */
interface TreeChangePlan {
  name: string
  origin: WriteOrigin
  protection: 'write' | 'delete' | 'none'
  writes: TreeChangeWrite[]
  auditAction: string
  auditSummary: string
  eventAction: string
}

function planRestructureSections(body: string, moves: SkillRestructureMove[]): RestructurePlan {
  const lines = body.split('\n')
  const spans: Array<{ start: number; end: number; rel: string; heading: string; text: string }> = []
  for (const move of moves) {
    const wanted = move.heading.trim()
    const starts: number[] = []
    for (let i = 0; i < lines.length; i += 1) {
      const match = /^#{2}\s+(.+?)\s*$/.exec(lines[i] ?? '')
      const title = match?.[1]?.trim() ?? ''
      if (title === wanted) starts.push(i)
    }
    const [start] = starts
    if (start === undefined) return { error: `no "## ${wanted}" heading in the body` }
    if (starts.length > 1) return { error: `heading "## ${wanted}" appears ${starts.length} times (ambiguous anchor)` }
    let end = lines.length
    for (let i = start + 1; i < lines.length; i += 1) {
      // H2 is the section boundary: a moved section spans to the NEXT `##`
      // heading (or EOF). Deeper headings travel with their parent section —
      // anchors are H2-only, so H2-anchored sections can never nest.
      if (/^#{2}\s/.test(lines[i] ?? '')) {
        end = i
        break
      }
    }
    if (end === start + 1) return { error: `heading "## ${wanted}" has an empty section` }
    if (spans.some(span => start === span.start)) return { error: `heading "## ${wanted}" is moved twice` }
    spans.push({
      start,
      end,
      rel: move.toFile,
      heading: wanted,
      text: lines.slice(start, end).join('\n'),
    })
  }
  // Rebuild the body line-wise: a moved section collapses to its pointer line.
  const byStart = new Map(spans.map(span => [span.start, span]))
  const rebuilt: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const span = byStart.get(i)
    if (span) {
      rebuilt.push(`${POINTER_LINE_PREFIX}${span.rel.split('/').at(-1)}`)
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
  audit?: { skillName: string; action: string; before: string | null; after: string | null; summary: string }
  event?: EvolutionSkillMutatedEvent
}

export class SkillLibrary {
  readonly root: string
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

  constructor(
    root = skillsRoot(),
    io: EvolutionIoLike = nodeEvolutionIo(),
    limits: SkillLimits = DEFAULT_SKILL_LIMITS,
    onMutation?: (event: EvolutionSkillMutatedEvent) => void,
    transact?: typeof transactIo,
    threatExemptLabels?: readonly string[],
  ) {
    this.root = root
    this.io = io
    this.limits = limits
    this.onMutation = onMutation
    this.threatExemptLabels = threatExemptLabels ?? []
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
    this.serial = makeSerialQueue()
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
  private async runSingleWrite(
    path: string,
    task: (current: string | null) => SingleWriteOutcome | Promise<SingleWriteOutcome>,
  ): Promise<SkillActionResult> {
    let outcome: SingleWriteOutcome | undefined
    const run = async (current: string | null) => {
      const o = await task(current ?? null)
      outcome = o
      // write: null = "leave the file untouched" — return the current bytes so
      // an existing file is preserved and a missing one stays missing (M-4).
      return o.write ?? (current ?? null)
    }
    let durabilityWarning = ''
    const committedOnly = (error: unknown): boolean => (error as { committed?: unknown } | undefined)?.committed === true
    if (this.transact) {
      try {
        await this.transact(this.io, path, run)
      } catch (error) {
        // A1-15 (v18): the rename landed and only the parent-directory fsync
        // failed. The bytes are visible, so this is NOT a failed write: keep the
        // audit/event below and report the durability warning instead of
        // letting a caller roll back (or retry) a write that already happened.
        if (!committedOnly(error)) throw error
        durabilityWarning = error instanceof Error ? error.message : String(error)
      }
    } else {
      const current = await this.io.readText(path)
      const next = await run(current)
      if (next !== null && next !== current) {
        try {
          await this.io.writeText(path, next)
        } catch (error) {
          if (!committedOnly(error)) throw error
          durabilityWarning = error instanceof Error ? error.message : String(error)
        }
      }
    }
    const o = outcome
    // V6-19 (0.3.37): a transact backend that violates the contract (never
    // invokes the task — a value-imported transact promised inside guarantees)
    // leaves `outcome` undefined; a structured error beats the TypeError the
    // unconditional dereference used to raise.
    if (o === undefined || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, 'write')) {
      return { ok: false, message: 'internal error: the write transaction did not invoke the task; no write was performed' }
    }
    if (o.write !== null && o.audit) {
      await this.audit(o.audit.skillName, o.audit.action, o.audit.before, o.audit.after, o.audit.summary)
    }
    if (o.write !== null && o.event) this.notifyMutation(o.event)
    // A1-15 (v18): audit and the mutation event ran even when only the fsync
    // failed — say so in the result instead of pretending the write failed.
    return durabilityWarning === '' || !o.result.ok
      ? o.result
      : { ...o.result, message: `${o.result.message} (warning: the write landed but the directory fsync failed — durability unconfirmed: ${durabilityWarning})` }
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

  async list(): Promise<SkillSummary[]> {
    const summaries: SkillSummary[] = []
    for (const name of await listNames(this.root, this.io)) {
      const dir = this.dirOf(name)
      const md = await this.io.readText(join(dir, 'SKILL.md'))
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
      return `Invalid skill name "${normalized}". Use lowercase letters, digits, and hyphens (<= ${this.limits.maxNameLength}).`
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
  async writeProtection(rawName: string, origin: WriteOrigin = 'foreground'): Promise<string | null> {

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
  async countSupportDirs(rawName: string): Promise<number> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    if (this.badName(name) !== null) return 0
    const dir = this.dirOf(name)
    let entries: string[]
    try { entries = await this.io.list(dir) } catch { return 0 }
    let count = 0
    for (const subdir of SUPPORT_DIRS) {
      if (!entries.includes(subdir)) continue
      try {
        const files = await this.io.list(join(dir, subdir))
        if (files.some(file => file !== '.gitkeep')) count += 1
      } catch {
        // Unknown support dir entry; not counted.
      }
    }
    return count
  }

  /**
   * Relative support-file paths (`references/x.md`) under SUPPORT_DIRS for one
   * skill; empty when the directory is unreadable or has no support files.
   * Used by the maintenance enrichment (011 §7) and probe reads.
   */
  async listSupportFiles(rawName: string): Promise<string[]> {
    // P1-1 (v14): no path is built from an unvalidated name here either.
    const name = rawName.trim()
    if (this.badName(name) !== null) return []
    const dir = this.dirOf(name)
    let entries: string[]
    try { entries = await this.io.list(dir) } catch { return [] }
    const out: string[] = []
    for (const subdir of SUPPORT_DIRS) {
      if (!entries.includes(subdir)) continue
      try {
        const files = await this.io.list(join(dir, subdir))
        for (const file of files) {
          if (file === '.gitkeep' || file.startsWith('.')) continue
          out.push(`${subdir}/${file}`)
        }
      } catch {
        // Subdir unreadable; treat as empty.
      }
    }
    return out
  }

  /**
   * Structure-health facts for one skill (rc.73 A1, 008 design): body
   * chars/density from SKILL.md, support groups from countSupportDirs, plus
   * optional usage counts (A2 churn dimension) when the caller has them.
   * Derived, never persisted; null when the skill is unreadable.
   */
  async assessHealth(    rawName: string,
    thresholds: SkillHealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
    counts?: { patchCount?: number; readCount?: number },
  ): Promise<SkillHealthAssessment | null> {
    const name = rawName.trim()
    const content = await this.read(name)
    if (content === null) return null
    return assessStructureHealth({
      skillName: name,
      bodyChars: content.length,
      bodyText: content,
      supportGroups: await this.countSupportDirs(name),
      patchCount: counts?.patchCount,
      readCount: counts?.readCount,
    }, thresholds)
  }

  /** Best-effort audit trail entry; never blocks the mutation. */
  private async audit(skillName: string, action: string, before: string | null, after: string | null, summary: string): Promise<void> {
    try {
      await recordMutation(this.root, this.io, {
        skillName,
        action,
        ...before === null ? {} : { beforeHash: contentHash(before) },
        ...after === null ? {} : { afterHash: contentHash(after) },
        summary,
        at: new Date().toISOString(),
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
   * Pin or unpin a skill (`.pinned` marker). Pinned skills are protected from
   * deletion, from background-review writes, and from the lifecycle — a
   * protective mutation, so the autonomous pipeline may never call it. The
   * marker write is the only state change; content is untouched.
   */
  async setPinned(name: string, pinned: boolean, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
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
      return { ok: false, message: 'Only the foreground (user or the main agent) may pin or unpin skills.' }
    }
    let durabilityWarning = ''
    const dir = this.dirOf(normalized)
    const marker = markerPath(dir, 'pinned')
    const existing = await this.io.exists(marker)
    if (pinned && existing) return { ok: true, message: `Skill "${normalized}" is already pinned.`, path: dir }
    if (!pinned && !existing) return { ok: true, message: `Skill "${normalized}" is not pinned; nothing to do.`, path: dir }
    if (!await this.io.exists(join(dir, 'SKILL.md'))) {
      return { ok: false, message: `Skill "${normalized}" not found.` }
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
        const leftovers = await this.io.list(dir).catch(() => [] as string[])
        if (leftovers.length === 0) await this.io.remove(dir).catch(() => {})
        return { ok: false, message: `Skill "${normalized}" was archived concurrently while pinning; the partial marker was removed — retry after the mover settles.` }
      }
    } else {
      await this.io.remove(marker)
    }
    await this.audit(normalized, pinned ? 'pin' : 'unpin', null, null, pinned ? 'pinned' : 'unpinned')
    return {
      ok: true,
      message: `${pinned
        ? `Skill "${normalized}" pinned: protected from deletion, background review, and the lifecycle.`
        : `Skill "${normalized}" unpinned.`}${durabilityWarning === '' ? '' : ` (warning: the write landed but the directory fsync failed — durability unconfirmed: ${durabilityWarning})`}`,
      path: dir,
    }
  }

  async create(name: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    const normalized = name.trim()
    // P2-3 (v11): the exists-probe → write window runs under the in-process
    // serialize queue (F-208 discipline, like update/patch) — two concurrent
    // create calls for one name used to both pass exists() and double-write
    // (double audit, double mutation event).
    return await this.serial(() => this.createCore(normalized, content, origin))
  }

  private async createCore(normalized: string, content: string, origin: WriteOrigin): Promise<SkillActionResult> {
    // C-12 (v10 audit): the inline badName() copy is gone (see setPinned).
    const bad = this.badName(normalized)
    if (bad) return { ok: false, message: bad }
    const validation = validateFrontmatter(content, normalized, this.limits)
    if (validation) return { ok: false, message: validation }
    // 0.3.11: frontmatter normalization happens at the write point — the
    // platform catalog parses strict YAML, so unquoted plain scalars carrying
    // `: ` (etc.) would silently make the skill invisible to the platform.
    const norm = normalizeFrontmatter(content)
    if (norm.issues.length > 0) return { ok: false, message: `Skill "${normalized}" frontmatter cannot be auto-fixed: ${norm.issues[0]} — wrap the value in double quotes and retry.` }
    const finalContent = norm.changed ? norm.content : content
    if (norm.changed) {
      const revalidated = validateFrontmatter(finalContent, normalized, this.limits)
      if (revalidated) return { ok: false, message: revalidated }
    }
    const threat = this.contentThreatBlock(finalContent)
    if (threat) return { ok: false, message: threat }
    const dir = this.dirOf(normalized)
    if (await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${normalized}" already exists.` }
    // v21 (D-6): NTFS and macOS default filesystems match names case-
    // insensitively while the skill namespace is lowercase-only — a hand-
    // maintained tree carrying `My-Tool/` made create('my-tool') diverge
    // across platforms (exists-refusal on win32, silently created beside it
    // on POSIX, vanishing after a git/WSL round-trip). Probe the listing for
    // a case-variant and refuse with the variant named, so the refusal reads
    // the same everywhere. Read paths stay platform-native (fail-closed).
    for (const entry of await this.io.list(this.root).catch(() => [] as string[])) {
      if (typeof entry === 'string' && entry !== normalized && entry.toLowerCase() === normalized.toLowerCase()) {
        return { ok: false, message: `Skill "${normalized}" collides with the existing case-variant directory "${entry}" (skill names are lowercase-only); rename one of them.` }
      }
    }
    // C-15: a pre-existing directory carrying a protection marker is
    // refused — the same writeProtection() verdict update/patch apply — so
    // create() can no longer drop a SKILL.md into a bundled/hub-installed
    // (or, for the review channel, pinned) tree it does not own.
    const protection = await this.writeProtection(normalized, origin)
    if (protection) return { ok: false, message: `Skill "${normalized}" is protected (${protection}).` }
    // F-337: hash the bytes that actually land on disk (write uses
    // trimEnd()+'\n'), so the audit afterHash is replay-identical to the file.
    const onDisk = finalContent.trimEnd() + '\n'
    const createPath = join(dir, 'SKILL.md')
    // P3 (v17): the already-exists refusal moves INSIDE the cross-process
    // transact — the lock-free probe above could be raced by a concurrent
    // create on another instance/process, and the later write silently
    // overwrote the winner's bytes (double audit, double event). In-lock
    // re-check: current bytes present -> structured refusal, nothing written.
    let existsAtCommit = false
    let taskRan = false
    let createDurabilityWarning = ''
    if (this.transact) {
      try {
        await this.transact(this.io, createPath, (current) => {
          taskRan = true
          if (current !== null) { existsAtCommit = true; return current }
          return onDisk
        })
      } catch (error) {
        // P2-2 (v19): the SKILL.md landed; only the dir fsync failed.
        if (!isCommittedOnly(error)) throw error
        createDurabilityWarning = error instanceof Error ? error.message : String(error)
      }
    } else if (await this.io.exists(createPath)) {
      taskRan = true
      existsAtCommit = true
    } else {
      taskRan = true
      try {
        await this.io.writeText(createPath, onDisk)
      } catch (error) {
        if (!isCommittedOnly(error)) throw error
        createDurabilityWarning = error instanceof Error ? error.message : String(error)
      }
    }
    // A1-22 (v18): a contract-violating transact that never invokes the
    // task used to report success with no file. Mirror runSingleWrite.
    if (!taskRan) return { ok: false, message: 'internal error: the create transaction did not invoke the task; no file was written' }
    if (existsAtCommit) return { ok: false, message: `Skill "${normalized}" already exists.` }
    // Any non-foreground writer (review channel OR delegated subagent) is an
    // agent-authored skill: mark it managed so the lifecycle owns it.
    // v22 (LOCK-4): the marker lands only while the body we just wrote is
    // still on disk — a concurrent archive moving the fresh directory away
    // would otherwise let writeText's mkdir resurrect the old path as a
    // SKILL.md-less ghost (same compensating cleanup as setPinnedCore).
    if (origin !== 'foreground') {
      await this.io.writeText(markerPath(dir, 'hermes-managed'), '')
      if (!(await this.io.exists(createPath))) {
        await this.io.remove(markerPath(dir, 'hermes-managed')).catch(() => {})
        // v23 (BR-5): same content re-check as setPinnedCore — never recurse
        // away a directory a concurrent restore just landed.
        const leftovers = await this.io.list(dir).catch(() => [] as string[])
        if (leftovers.length === 0) await this.io.remove(dir).catch(() => {})
        return { ok: false, message: `Skill "${normalized}" was archived concurrently while being created; the partial marker was removed — retry once the mover settles.` }
      }
    }
    await this.audit(normalized, 'create', null, onDisk, 'created')
    this.notifyMutation({ action: 'create', name: normalized, skillDir: dir })
    return {
      ok: true,
      message: `Skill "${normalized}" created.${createDurabilityWarning === '' ? '' : ` (warning: the write landed but the directory fsync failed — durability unconfirmed: ${createDurabilityWarning})`}`,
      path: dir,
      ...(norm.changed ? { normalizedFrontmatterFields: norm.fields } : {}),
    }
  }

  async update(rawName: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()
    // F-208: the whole read→validate→write runs under the in-process serialize
    // queue so two concurrent updates on one skill never interleave.
    return await this.serial(() => this.updateCore(name, content, origin))
  }

  private async updateCore(name: string, content: string, origin: WriteOrigin): Promise<SkillActionResult> {
    // P3 (v15): guard BEFORE dirOf — same order as patchCore, so no path
    // string is ever built from an unvalidated name (dirOf does not touch IO,
    // so this is consistency hygiene, not a reachable gap).
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    const path = join(dir, 'SKILL.md')
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateFrontmatter(content, name, this.limits)
    if (validation) return { ok: false, message: validation }
    // 0.3.11: normalize at the write point (see create) — same reasoning.
    const norm = normalizeFrontmatter(content)
    if (norm.issues.length > 0) return { ok: false, message: `Skill "${name}" frontmatter cannot be auto-fixed: ${norm.issues[0]} — wrap the value in double quotes and retry.` }
    const finalContent = norm.changed ? norm.content : content
    if (norm.changed) {
      const revalidated = validateFrontmatter(finalContent, name, this.limits)
      if (revalidated) return { ok: false, message: revalidated }
    }
    const threat = this.contentThreatBlock(finalContent)
    if (threat) return { ok: false, message: threat }
    return await this.runSingleWrite(path, (current) => {
      if (current === null) return { result: { ok: false, message: `Skill "${name}" not found.` }, write: null }
      // F-318 (②): a byte-equivalent rewrite (same content modulo trailing
      // newlines) is a no-op — no write, no audit, no mutation event, so the
      // mutation-maturity counter is not inflated by a redundant re-save.
      if (finalContent.trimEnd() === current.trimEnd()) {
        return { result: { ok: true, message: `Skill "${name}" unchanged: the supplied content already matches the current file; nothing written.`, noop: true, path: dir }, write: null }
      }
      // F-337: hash the BYTES that actually land on disk (write uses
      // trimEnd()+'\n'), so the audit afterHash is replay-identical to the file.
      const onDisk = finalContent.trimEnd() + '\n'
      return {
        result: { ok: true, message: `Skill "${name}" updated.`, path: dir, ...(norm.changed ? { normalizedFrontmatterFields: norm.fields } : {}) },
        write: onDisk,
        audit: { skillName: name, action: 'update', before: current, after: onDisk, summary: 'updated' },
        event: { action: 'update', name, skillDir: dir },
      }
    })
  }

  async patch(rawName: string, oldString: string, newString: string, filePath = '', replaceAll = false, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
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
    if (!await this.io.exists(skillMd)) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }

    let target = skillMd
    let patchLabel = 'SKILL.md'
    if (filePath) {
      const validation = validateSupportPath(filePath)
      if (validation) return { ok: false, message: validation }
      target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
      patchLabel = filePath
    }
    return await this.runSingleWrite(target, (current) => {
      const md = current
      if (md === null) return { result: { ok: false, message: `File not found: ${patchLabel}` }, write: null }

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
      if (patched === null) return { result: { ok: false, message: `Could not find old_string in "${name}/${patchLabel}" (or the replaceAll fuzzy budget was exceeded). Use update for a full rewrite.` }, write: null }
      let writeContent = patched
      let normalizedFields: string[] | undefined
      if (target === skillMd) {
        const validation = validateFrontmatter(patched, name, this.limits)
        if (validation) return { result: { ok: false, message: `Patch rejected: ${validation}` }, write: null }
        // 0.3.11: normalize at the write point (see create) — a patch may edit
        // the frontmatter directly.
        const norm = normalizeFrontmatter(patched)
        if (norm.issues.length > 0) return { result: { ok: false, message: `Patch rejected: frontmatter cannot be auto-fixed (${norm.issues[0]}).` }, write: null }
        if (norm.changed) {
          writeContent = norm.content
          normalizedFields = norm.fields
          const revalidated = validateFrontmatter(writeContent, name, this.limits)
          if (revalidated) return { result: { ok: false, message: `Patch rejected: ${revalidated}` }, write: null }
        }
      }
      if (Buffer.byteLength(writeContent, 'utf8') > this.limits.maxSkillFileBytes && target !== skillMd) {
        return { result: { ok: false, message: `Patched file exceeds ${this.limits.maxSkillFileBytes} bytes.` }, write: null }
      }
      if (writeContent.length > this.limits.maxSkillContentChars && target === skillMd) {
        return { result: { ok: false, message: `Patched content exceeds ${this.limits.maxSkillContentChars} characters. Consider splitting into a smaller SKILL.md with supporting files.` }, write: null }
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
        return { result: { ok: true, message: `Skill "${name}" unchanged: old_string already equals the replacement (${patchLabel}); nothing written.`, noop: true, path: dir }, write: null }
      }
      // F-337: hash the bytes that actually land on disk (write uses
      // trimEnd()+'\n'), so the audit afterHash is replay-identical to the file.
      const onDisk = writeContent.trimEnd() + '\n'
      return {
        result: { ok: true, message: `Skill "${name}" patched (${patchLabel}).`, path: dir, ...(normalizedFields ? { normalizedFrontmatterFields: normalizedFields } : {}) },
        write: onDisk,
        audit: { skillName: name, action: 'patch', before: md, after: onDisk, summary: `patched ${patchLabel}` },
        event: { action: 'patch', name, skillDir: dir },
      }
    })
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
          return `the copy succeeded but the source could not be removed (${reason}); the copied tree was rolled back`
        } catch {
          return `the copy succeeded but the source could not be removed (${reason}) and the copied tree could not be rolled back — the tree now exists in BOTH locations; clean up manually`
        }
      }
    }
  }

  /**
   * P2 (v16): the write-lock probe for the DESTRUCTIVE MOVERS (archive /
   * restoreFromArchive). A byte-writer mid-flight is the ghost-generator —
   * after the move its transact commit re-creates `<dir>/…` (mkdir
   * recursive) and the tree ends half-archived. The signal is the writer's
   * own lock file, and its PLACEMENT (inside the moved directory) is why the
   * mover must PROBE-and-REFUSE instead of acquiring it: an acquired lock
   * would be renamed into `.archive` with the tree, stranding a phantom live
   * lock (the v16 audit proved the probe→rename TOCTOU does exactly that,
   * and restore would later move the residue back into the live root).
   * Coverage: `SKILL.md.lock` (update/patch of the body) plus one level of
   * each support dir (write_file's lock sits next to its file). Residual:
   * NESTED support-subdir locks and the probe→rename TOCTOU itself remain
   * fail-safe (renameWithRetry rides the write out; the writer's locked
   * re-read refuses on the moved-away file), and a residue `.lock` from a
   * CRASHED writer also refuses — correct: inspect, don't archive.
   */
  private async hasWriteLock(dir: string): Promise<boolean> {
    // P3 (v17): marker writers (pin / hermes-managed) hold root-level locks
    // too — include them in the signal set.
    const markerLocks = MARKER_LOCK_NAMES.map(name => join(dir, name))
    for (const lock of markerLocks) {
      if (await this.isWriterLock(lock)) return true
    }
    for (const supportDir of SUPPORT_DIRS) {
      let entries: string[]
      try { entries = await this.io.list(join(dir, supportDir)) } catch {
        // P3 (v17): fail-CLOSED — a real list failure (EACCES/EIO; a missing
        // dir reads as [] per the seam contract) must refuse the move, not
        // read as "no locks". The v16 draft's `continue` re-opened the ghost
        // window exactly when the filesystem is misbehaving.
        return true
      }
      for (const entry of entries) {
        if (!entry.endsWith(LOCK_SUFFIX)) continue
        if (await this.isWriterLock(join(dir, supportDir, entry))) return true
      }
    }
    return false
  }

  /** P2 (v17): a file only counts as a writer lock when its body has the
   * `pid:token` shape the io layer writes. User support files legitimately
   * named `*.lock` (allowed by SUPPORT_FILE_NAME_RE) must not trip the probe
   * or be swept as residue — the v16 first cut matched on suffix alone,
   * which permanently refused archiving and deleted user content on restore. */
  private async isWriterLock(lockPath: string): Promise<boolean> {
    let body: string | null
    try {
      body = await this.io.readText(lockPath)
    } catch {
      // A1-8 (v18): a real read failure (EACCES/EIO) must not read as "no
      // lock" — the mover would proceed while a writer may hold it. Only a
      // missing read (the seam's null) is "no lock".
      return true
    }
    if (body === null) return false
    return LOCK_BODY_RE.test(body.trim())
  }

  /** P2 (v16): best-effort removal of lock residue inside a RESTORED tree.
   * A1-2/A1-7 (v18): the sweep now covers the marker locks the probe checks
   * (`SKILL.md.lock`/`.pinned.lock`/`.hermes-managed.lock`) and only removes
   * a lock whose holder pid is NOT alive — a live writer's lock is never
   * stolen by the sweep. A dead-pid residue would otherwise permanently
   * refuse archive/restore. */
  private async deleteStrandedLocks(dir: string): Promise<void> {
    // P2 (v17): the body-shape check keeps user support files named
    // `*.lock` (verified: restore used to delete them) out of the sweep.
    // v20 (A-1): the three root-level names come from MARKER_LOCK_NAMES
    // (F-17 single source) instead of re-inlined literals — a renamed marker
    // can no longer silently drop out of the sweep.
    for (const markerLock of MARKER_LOCK_NAMES) await this.sweepLockIfStranded(join(dir, markerLock))
    for (const supportDir of SUPPORT_DIRS) {
      let entries: string[] = []
      try { entries = await this.io.list(join(dir, supportDir)) } catch { continue }
      for (const entry of entries) {
        if (entry.endsWith(LOCK_SUFFIX)) await this.sweepLockIfStranded(join(dir, supportDir, entry))
      }
    }
  }

  /** Remove `lockPath` only when its body has the writer-lock `pid:token`
   * shape AND the holder pid is not alive; anything else (a user support file
   * or a live writer's lock) is left untouched. */
  private async sweepLockIfStranded(lockPath: string): Promise<void> {
    const body = await this.io.readText(lockPath).catch(() => null)
    if (body === null) return
    // v20 (A-1): consume the shared `parseLockBody` instead of the previously
    // inlined third copy of the lock-body regex (F-17 single-source contract).
    const pid = parseLockBody(body)
    if (pid === null) return
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) return
    await this.io.remove(lockPath).catch(() => {})
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

  /** A1-7 (v18): a root-level lock whose holder is alive must refuse the
   * restore; a dead residue is swept so a crashed writer cannot block
   * recovery. A non-lock body shape is left alone (user file). */
  private async refuseLiveLockOrSweep(lockPath: string, label: string): Promise<void> {
    // P2-5 (v19): a read failure is NOT "no lock". The v18 shape swallowed it
    // (`.catch(() => null)`) and let the restore proceed over a possibly-live
    // writer — the opposite direction of `isWriterLock`'s fail-closed rule in
    // this same file. Refuse the restore instead.
    let body: string | null
    try {
      body = await this.io.readText(lockPath)
    } catch (error) {
      throw new Error(`snapshot restore refused: cannot verify ${label} (${error instanceof Error ? error.message : String(error)}); a live writer may hold it`)
    }
    if (body === null) return
    // v20 (A-1): shared `parseLockBody` (F-17 single-source) — same shape
    // rule as `sweepLockIfStranded` above.
    const pid = parseLockBody(body)
    if (pid === null) return
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
      throw new Error(`snapshot restore refused: ${label} is being written (write lock present); retry once the write completes`)
    }
    await this.io.remove(lockPath).catch(() => {})
  }

  async archive(rawName: string, options: ArchiveOptions = {}): Promise<SkillActionResult> {

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
    if (md === null) return { ok: false, message: `Skill "${name}" not found.` }
    // C-13 (v10 audit): the redundant ternary is gone — deleteProtection now
    // accepts an explicit `undefined` allowBundled, so the options object
    // passes through verbatim.
    const protection = await this.deleteProtection(name, options)
    if (protection) {
      return {
        ok: false,
        message: protection === 'pinned'
          ? `Skill "${name}" is pinned and cannot be archived. Remove the \`.pinned\` marker in its directory, then retry.`
          : `Skill "${name}" is protected (${protection}).`,
      }
    }
    if (options.absorbedInto) {
      // 0.3.18 (E-69): `delete X absorbed_into=X` used to pass the existence
      // check (it read the archived skill's own still-present file) and
      // archive X "into itself". Refuse the self-absorption up front.
      if (options.absorbedInto.trim() === name) {
        return { ok: false, message: 'absorbed_into cannot be the skill being archived (cannot absorb into itself).' }
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
      if (link === true) return { ok: false, message: `Skill "${name}" is a symlink; refusing to archive it.` }
    }
    // P2-9 (v15)/v16: probe-and-refuse while any writer is active (see
    // `hasWriteLock` for the signal set and the placement rationale).
    if (await this.hasWriteLock(dir)) {
      return { ok: false, message: `Skill "${name}" is being written (write lock present); retry archiving once the write completes.` }
    }
    const moveFailure = await this.moveDir(dir, dest)
    if (moveFailure !== undefined) return { ok: false, message: `Skill "${name}" archive failed: ${moveFailure}.` }
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
    await this.audit(name, 'archive', md, null, reason)
    this.notifyMutation({ action: 'archive', name, archivedPath: dest })
    return { ok: true, message: `Skill "${name}" archived to .archive.`, path: dest }
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
   */
  async consolidate(
    target: string,
    sources: string[],
    origin: WriteOrigin = 'foreground',
    options: { mode?: 'append' | 'reference' } = {},
  ): Promise<SkillActionResult> {
    // Names normalize before validation (rc.42 audit P2-5): the trimmed form
    // is what every path-building call below resolves to, so validation and
    // IO can never disagree about which skill is meant.
    const targetName = target.trim()
    const normalizedSources = [...new Set(sources.map(name => name.trim()))].filter(name => name !== targetName)
    const mode = options.mode ?? 'append'
    if (normalizedSources.length === 0) return { ok: false, message: 'Consolidation requires at least one distinct source skill.' }
    for (const name of [targetName, ...normalizedSources]) {
      // C-16: the name guard is badName() now — consolidate gains the
      // same 64-char length ceiling and message form as every other mutator.
      const bad = this.badName(name)
      if (bad) return { ok: false, message: bad }
    }
    const targetDir = this.dirOf(targetName)
    const targetProtection = await this.writeProtection(targetName, origin)
    if (targetProtection) return { ok: false, message: `Skill "${targetName}" is protected (${targetProtection}).` }
    // V8-11 (0.3.46): the targetMd pre-read below MOVED into the serial queue
    // (commit section) — a concurrent patch between the old pre-read and the
    // commit used to be silently overwritten by the merged body.
    const referenceWrites: TreeChangeWrite[] = []
    const parts: string[] = []
    if (mode === 'append') {
      for (const source of normalizedSources) {
        const protection = await this.deleteProtection(source)
        if (protection) return { ok: false, message: `Skill "${source}" is protected (${protection}).` }
        const sourceMd = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
        if (!sourceMd) return { ok: false, message: `Skill "${source}" not found.` }
        const parsed = parseFrontmatter(sourceMd)
        if (!parsed) return { ok: false, message: `Skill "${source}" has no valid frontmatter; refusing to merge.` }
        // Package integrity (009-I): an append must never leave dangling
        // support links — refuse before ANY side effect (no archive, no write).
        if (await this.countSupportDirs(source) > 0) {
          return { ok: false, message: `Consolidation rejected: source "${source}" carries support files — use mode:'reference' or archive the whole package instead.` }
        }
        const refs = supportRefs(parsed.body)
        if (refs.length > 0) {
          return { ok: false, message: `Consolidation rejected: source "${source}" body references support files (${refs.join(', ')}) that would be left behind — use mode:'reference' or archive the whole package instead.` }
        }
        parts.push(`\n<!-- consolidated from ${source} at ${new Date().toISOString()} -->\n${parsed.body.trim()}`)
      }
    } else {
      for (const source of normalizedSources) {
        const protection = await this.deleteProtection(source)
        if (protection) return { ok: false, message: `Skill "${source}" is protected (${protection}).` }
        const sourceMd = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
        if (!sourceMd) return { ok: false, message: `Skill "${source}" not found.` }
        const parsed = parseFrontmatter(sourceMd)
        if (!parsed) return { ok: false, message: `Skill "${source}" has no valid frontmatter; refusing to demote.` }
        const refs = supportRefs(parsed.body)
        if (refs.length > 0) {
          return { ok: false, message: `Consolidation rejected: source "${source}" body references support files (${refs.join(', ')}) that would be left behind — archive the whole package instead.` }
        }
        const target = join(targetDir, 'references', `${source}.md`)
        referenceWrites.push({ target, content: `<!-- demoted from ${source} at ${new Date().toISOString()} -->\n${parsed.body.trim()}\n` })
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
      if (!preTargetMd) return { ok: false, message: `Skill "${targetName}" not found.` }
      for (const source of normalizedSources) {
        const result = await this.archive(source, { absorbedInto: targetName })
        if (!result.ok) throw new Error(result.message)
        archived.push(source)
      }
      // V8-11 (0.3.46): the target pre-read and the merged/pointer construction
      // moved INSIDE the in-process serialize queue — a concurrent
      // patch/update between the old pre-read and the commit used to be
      // silently overwritten (the serial chain is the same second layer
      // update/patch/restructure/writeSupportFile use).
      const result = await this.serial(async (): Promise<SkillActionResult> => {
        const freshTargetMd = await this.io.readText(join(targetDir, 'SKILL.md'))
        if (!freshTargetMd) return { ok: false, message: `Skill "${targetName}" not found.` }
        // V10-01 (P2-2): reference-mode targets APPEND, mirroring restructure
        // (base + '\n\n' + new text) — a second consolidate of a re-created
        // source used to overwrite the first demotion's bytes (silent loss of
        // the older degraded knowledge). The previous bytes are read INSIDE
        // the serial queue (V8-11 discipline), so a concurrent patch between
        // planning and commit is never silently overwritten; applyTreeChange
        // re-reads at commit for the rollback bytes.
        const writes: TreeChangeWrite[] = []
        for (const reference of referenceWrites) {
          const previous = await this.io.readText(reference.target).catch(() => null)
          const base = previous?.trimEnd() ?? ''
          // V24-01: carry the plan-time bytes as the CAS baseline — a read
          // error here reads as null and stays fail-closed at commit (an
          // existing file then counts as drift).
          writes.push({ target: reference.target, content: base === '' ? reference.content : `${base}\n\n${reference.content}`, expected: previous })
        }
        if (mode === 'append') {
          const merged = freshTargetMd.trimEnd() + parts.join('\n') + '\n'
          const validation = validateFrontmatter(merged, targetName, this.limits)
          if (validation) return { ok: false, message: `Consolidation rejected: ${validation}` }
          writes.push({ target: join(targetDir, 'SKILL.md'), content: merged, expected: freshTargetMd })
        } else {
          const pointerLines = normalizedSources.map(source => `\n${POINTER_LINE_PREFIX}${source}.md`).join('')
          const extended = freshTargetMd.trimEnd() + pointerLines + '\n'
          const validation = validateFrontmatter(extended, targetName, this.limits)
          if (validation) return { ok: false, message: `Consolidation rejected: ${validation}` }
          writes.push({ target: join(targetDir, 'SKILL.md'), content: extended, expected: freshTargetMd })
        }
        return await this.applyTreeChange({
          name: targetName,
          origin,
          protection: 'write',
          writes,
          auditAction: 'consolidate',
          auditSummary: `consolidated ${normalizedSources.join(', ')} (${mode}) into ${targetName}`,
          eventAction: 'consolidate',
        })
      })
      if (!result.ok) throw new Error(result.message)
      return { ok: true, message: `Consolidated ${normalizedSources.join(', ')} into "${targetName}".`, path: targetDir }
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
        return { ok: false, message: `Consolidation failed (${reason}); rolled back EXCEPT ${failedRestores.join(', ')} — still in .archive, restore them with /evolution skill restore.` }
      }
      return { ok: false, message: `Consolidation failed and was rolled back: ${reason}` }
    }
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
  async restructure(rawName: string, moves: SkillRestructureMove[], origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    const name = rawName.trim()
    // F-208: the whole read→plan→write runs under the in-process serialize
    // queue so two concurrent restructures on one skill never interleave.
    return await this.serial(() => this.restructureCore(name, moves, origin))
  }

  private async restructureCore(name: string, moves: SkillRestructureMove[], origin: WriteOrigin): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    if (moves.length === 0) return { ok: false, message: 'Restructure requires at least one section move.' }
    if (moves.length > MAX_RESTRUCTURE_MOVES) return { ok: false, message: `Restructure exceeds ${MAX_RESTRUCTURE_MOVES} moves.` }
    for (const move of moves) {
      // V24-20a (v24): element-shape guard BEFORE the field reads — a null
      // element used to throw on `move.heading` instead of returning the
      // structured refusal the library owes every entry point. The `unknown`
      // view is deliberate: the declared element type promises an object, but
      // model/plan payloads have historically crossed that promise (V8-09).
      const raw: unknown = move
      if (raw === null || typeof raw !== 'object') {
        return { ok: false, message: 'Every restructure move must be an object with a heading.' }
      }
      if (typeof move.heading !== 'string' || !move.heading.trim()) {
        return { ok: false, message: 'Every restructure move needs a non-empty heading.' }
      }
      // A1-6 (v18): reuse the single validator (regex + Windows device stems)
      // so restructure cannot mint a target the support-file layer refuses.
      const targetIssue = validateRestructureTarget(move.toFile)
      if (targetIssue) return { ok: false, message: targetIssue }
    }
    const dir = this.dirOf(name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
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
    if (!block) return { ok: false, message: 'SKILL.md has no valid frontmatter; refusing to restructure.' }
    // P1-1 (v7 audit): the planner must receive the BODY ONLY — its rebuilt
    // body is spliced after the frontmatter header, so feeding it the full
    // text duplicated the frontmatter on every successful restructure (a
    // second `---` block the lenient parser tolerated but strict YAML
    // consumers read as duplicate name/description keys).
    const header = block.lines.slice(0, block.end + 1).join(block.nl)
    const bodyRaw = md.slice(header.length)
    const plan = planRestructureSections(bodyRaw.replace(/\r\n/g, '\n'), moves)
    if ('error' in plan) return { ok: false, message: `Restructure rejected: ${plan.error}` }
    const newMd = `${header}${plan.body}`.replace(/\r\n/g, '\n')
    const finalMd = block.nl === '\r\n' ? newMd.replace(/\n/g, '\r\n') : newMd
    const newMdCheck = validateFrontmatter(finalMd, name, this.limits)
    if (newMdCheck) return { ok: false, message: `Restructure rejected: ${newMdCheck}` }
    for (const section of plan.sections) {
      const refs = supportRefs(section.text)
      if (refs.length > 0) {
        return { ok: false, message: `Restructure rejected: section "## ${section.heading}" references support files (${refs.join(', ')}) that stay behind — split the section or move it with its files.` }
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
      const previous = await this.io.readText(target).catch(() => null)
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
    const result = await this.applyTreeChange({
      name,
      origin,
      protection: 'write',
      writes,
      auditAction: 'restructure',
      auditSummary: `moved ${plan.sections.length} section(s): ${[...byRel.keys()].join(', ')}`,
      eventAction: 'restructure',
    })
    if (!result.ok) return result
    return { ok: true, message: `Restructured "${name}": moved ${plan.sections.length} section(s) to references/.`, path: dir }
  }

  /**
   * Unified tree-change commit point (009 kernel): owns validation order,
   * pre-read rollback bytes, two-phase write with byte-level rollback, audit
   * and the mutation event. Mutators compose `TreeChangePlan`s — consolidate,
   * restructure (and future reference-mode consolidations) never implement
   * two-phase commit themselves.
   */
  private async applyTreeChange(plan: TreeChangePlan): Promise<SkillActionResult> {
    const name = plan.name.trim()
    const badName = this.badName(name, { allowReserved: true })
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = plan.protection === 'write'
      ? await this.writeProtection(name, plan.origin)
      : plan.protection === 'delete'
        ? await this.deleteProtection(name)
        : null
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    // Pre-read EVERY write target: the rollback bytes are kernel-owned and the
    // caller cannot fabricate them. The same read feeds the append semantics of
    // restructure (the caller re-reads for its own construction — kernel reads
    // again because the bytes it restores must be the bytes on disk at commit).
    const landing: Array<{ target: string; content: string; previous: string | null; expected: string | null | undefined }> = []
    for (const write of plan.writes) {
      // A1-11 (v18): a read failure (EACCES/EIO) is NOT "missing" —
      // treating it as null made the rollback delete a file it could not
      // restore. Refuse the whole plan before any write.
      let previous: string | null
      try {
        previous = await this.io.readText(write.target)
      } catch (error) {
        return { ok: false, message: `Tree change refused: cannot safely pre-read ${write.target} (${error instanceof Error ? error.message : String(error)}); no writes were performed` }
      }
      if (Buffer.byteLength(write.content, 'utf8') > this.limits.maxSkillFileBytes) {
        return { ok: false, message: `Write exceeds ${this.limits.maxSkillFileBytes} bytes: ${write.target}` }
      }
      const threat = this.contentThreatBlock(write.content)
      if (threat) return { ok: false, message: threat }
      landing.push({ target: write.target, content: write.content, previous, expected: write.expected })
    }
    const written: Array<{ target: string; previous: string | null }> = []
    let durabilityWarning = ''
    try {
      for (const entry of landing) {
        try {
          if (this.transact) {
            // v22 (LOCK-1): CAS write — the previous blind writeText committed
            // plan-time bytes over whatever was on disk, so a concurrent
            // patch/update (another process, shared DSH_HOME) between the
            // pre-read above and this write was silently overwritten (lost
            // update; both writers reported success). The task only commits
            // when the disk still holds the pre-read baseline; any drift
            // aborts the plan into the rollback below.
            // v24 (V24-01): the CAS baseline is the caller's PLAN-TIME bytes
            // (`expected`) when the write carries them — the pre-read above
            // only supplies the rollback bytes. Lock-1's own pre-read baseline
            // still left a window for appends/merges built from an earlier
            // read: a concurrent write landing between planning and the
            // pre-read became the CAS baseline, so plan-time content
            // (composed WITHOUT it) committed cleanly over it — lost update,
            // both writers successful. Comparing against the plan-time bytes
            // closes the whole planning→commit span.
            // P3 (v22; gate fix 0.3.66): the flag lives in a holder so the
            // control-flow analysis (which cannot see the transact callback's
            // assignment) does not narrow it to a literal `false`.
            const baseline = entry.expected === undefined ? entry.previous : entry.expected
            const drift = { seen: false }
            await this.transact(this.io, entry.target, (current) => {
              if (current !== baseline) {
                drift.seen = true
                return current
              }
              return entry.content
            })
            if (drift.seen) {
              throw new Error(`concurrent modification detected: ${entry.target} changed after the plan was computed (a concurrent writer won the race); no further writes were performed`)
            }
          } else {
            // No transact backend: the previous blind write (the class was
            // constructed without cross-process exclusion anyway).
            await this.io.writeText(entry.target, entry.content)
          }
        } catch (error) {
          // A1-15 (v18): a post-rename dir-fsync failure means the bytes DID
          // land — rolling back would delete a visible write, and the audit/
          // event below must still run. Record it and keep going.
          if ((error as { committed?: unknown } | undefined)?.committed !== true) throw error
          durabilityWarning = error instanceof Error ? error.message : String(error)
        }
        written.push({ target: entry.target, previous: entry.previous })
      }
    } catch (error) {
      for (const entry of written.reverse()) {
        await (entry.previous === null
          ? this.io.remove(entry.target)
          : this.io.writeText(entry.target, entry.previous)
        ).catch(() => {
          // Rollback is best-effort; the .backups snapshot stays the recovery
          // path when the curator took one (control-plane rule).
        })
      }
      return { ok: false, message: `Tree change failed and was rolled back: ${error instanceof Error ? error.message : String(error)}` }
    }
    await this.audit(name, plan.auditAction, md, landing.find(entry => entry.target.split(/[\\/]/).pop() === 'SKILL.md')?.content ?? md, plan.auditSummary)
    this.notifyMutation({ action: plan.eventAction, name, skillDir: dir })
    return {
      ok: true,
      message: durabilityWarning === ''
        ? `${plan.eventAction} "${name}" succeeded.`
        : `${plan.eventAction} "${name}" succeeded (warning: the write landed but the directory fsync failed — durability unconfirmed: ${durabilityWarning})`,
      path: dir,
    }
  }

  /**
   * Restore one skill from `.archive/` back to the active root. Hermes-style
   * recoverability: archival never deletes, and this is the control-plane
   * path back. The `.archive-reason` marker is dropped on restore.
   */
  async restoreFromArchive(rawName: string): Promise<SkillActionResult> {
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
          ? `Skill "${name}" already exists in the active root; refusing to overwrite.`
          : `Skill directory "${name}" already exists in the active root but carries no SKILL.md; remove or repair it before restoring.`,
      }
    }
    const archiveRoot = join(this.root, '.archive')
    let entries: string[]
    try { entries = await this.io.list(archiveRoot) } catch { return { ok: false, message: 'No skill archive available.' } }
    // 0.3.16 (E-3): `${name}-` also matches a SIBLING skill's archive entry
    // (restoring `foo` used to pick `foo-bar` after a lexical sort: foo got
    // foo-bar's content and foo-bar's archive vanished). The directory stamp
    // makes the name unique, not the owner — verify each candidate's own
    // SKILL.md frontmatter name before restoring.
    const candidates = entries.filter(entry => entry === name || entry.startsWith(`${name}-`)).sort().reverse()
    let chosen: string | undefined
    for (const candidate of candidates) {
      const md = await this.io.readText(join(archiveRoot, candidate, 'SKILL.md')).catch(() => null)
      const parsed = parseFrontmatter(md ?? '')
      if (parsed?.frontmatter.name === name) { chosen = candidate; break }
    }
    if (!chosen) return { ok: false, message: `Skill "${name}" is not in .archive.` }
    const source = join(archiveRoot, chosen)
    // Symlink guard (G7): restoring a symlinked archive entry would recreate a
    // link in the active tree instead of the real content — refuse first.
    if (this.io.isSymlink) {
      const link = await this.io.isSymlink(source)
      if (link === true) return { ok: false, message: `Archived entry "${chosen}" is a symlink; refusing to restore it.` }
    }
    // P2-9 (v15): same writer-collision probe as archive — restoring ONTO a
    // skill a writer is mid-write on would drop the new bytes behind the
    // restored tree.
    if (await this.hasWriteLock(dest)) {
      return { ok: false, message: `Skill "${name}" is being written (write lock present); retry restoring once the write completes.` }
    }
    const moveFailure = await this.moveDir(source, dest)
    if (moveFailure !== undefined) {
      // 0.3.16 (E-13 follow-up): the fallback failure must come back as a
      // structured result, never a rejection — consolidates call this in a
      // rollback loop and a throw there would replace the rollback report.
      return { ok: false, message: `Restore of "${name}" from .archive failed: ${moveFailure}` }
    }
    // P2 (v16): scrub lock residue that rode inside the archived entry (a
    // crashed writer, or the archive-probe TOCTOU strand) — a live-pid lock
    // landing in the live root structurally closes the writers' self-heal and
    // would keep the restored skill unwritable until process restart.
    await this.deleteStrandedLocks(dest)
    if (await this.io.exists(join(dest, '.archive-reason'))) {
      await this.io.remove(join(dest, '.archive-reason'))
    }
    // P3 (v15): `.mutations.json` documents "records every skill mutation" —
    // restore (including consolidate's rollback restores) was the one
    // mutation invisible in the audit history. before=null (absent from the
    // tree), after=the restored SKILL.md bytes (best-effort read).
    await this.audit(name, 'restore', null, await this.io.readText(join(dest, 'SKILL.md')).catch(() => null), `restored from ${source}`)
    this.notifyMutation({ action: 'restore', name, skillDir: dest })
    return { ok: true, message: `Skill "${name}" restored from .archive.`, path: dest }
  }

  async writeSupportFile(rawName: string, filePath: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()
    // F-208: the whole read→validate→write runs under the in-process serialize
    // queue so two concurrent writers to one support file never interleave.
    return await this.serial(() => this.writeSupportFileCore(name, filePath, content, origin))
  }

  private async writeSupportFileCore(name: string, filePath: string, content: string, origin: WriteOrigin): Promise<SkillActionResult> {
    // P3 (v17): guard BEFORE dirOf — the last holdout of the old order
    // (updateCore/patchCore/removeSupportFileCore all check first).
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    if (!await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
    if (Buffer.byteLength(content, 'utf8') > this.limits.maxSkillFileBytes) return { ok: false, message: `Support file exceeds ${this.limits.maxSkillFileBytes} bytes.` }
    const threat = this.contentThreatBlock(content)
    if (threat) return { ok: false, message: threat }
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    return await this.runSingleWrite(target, (current) => {
      // V6-15 (0.3.36): a byte-equivalent (modulo trailing whitespace) rewrite
      // is a no-op — no write, no audit, no mutation event — so a repeated
      // write_file cannot inflate the mutation-maturity counter or churn the
      // catalog (the update/patch/memory-add noop discipline, 0.3.29).
      if (current !== null && content.trimEnd() === current.trimEnd()) {
        return { result: { ok: true, message: `Support file "${filePath}" unchanged: the supplied content already matches the current file; nothing written.`, noop: true, path: target }, write: null }
      }
      return {
        result: { ok: true, message: `Support file "${filePath}" written to "${name}".`, path: target },
        write: content,
        audit: { skillName: name, action: 'write_file', before: current, after: content, summary: `wrote ${filePath}` },
        event: { action: 'write_file', name, skillDir: dir, file: target },
      }
    })
  }

  async removeSupportFile(rawName: string, filePath: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()
    // P2-4 (v11): the exists/read/remove window runs under the serialize queue
    // — writeSupportFile wraps itself (F-208), so an unwrapped remove could
    // interleave with a concurrent write and silently drop its write.
    return await this.serial(() => this.removeSupportFileCore(name, filePath, origin))
  }

  private async removeSupportFileCore(name: string, filePath: string, origin: WriteOrigin): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    if (!await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    if (!await this.io.exists(target)) return { ok: false, message: `File "${filePath}" not found in skill "${name}".` }
    // P2-10 (v15): `io.remove` is a recursive rm, so a DIRECTORY path passed
    // as file_path (nested support dirs are a feature) would wipe the whole
    // subtree with only a null audit `before` — bytes gone without a hash.
    // A regular file always reads as a string here; exists+unreadable means
    // directory (EISDIR) or an unreadable file — refuse both (fail-closed;
    // directories must be removed file by file).
    const before = await this.io.readText(target).catch(() => null)
    if (before === null) return { ok: false, message: `"${filePath}" is not a readable regular file — remove the files inside it one by one.` }
    // A1-5 (v18): a bare `io.remove` does not participate in the write-lock
    // protocol, so a cross-instance/process writer could land its rename after
    // our read and have the bytes deleted while it reports success. Route the
    // delete through the same per-path transact lock (returning null = remove).
    if (this.transact) await this.transact(this.io, target, () => null)
    else await this.io.remove(target)
    await this.audit(name, 'remove_file', before, null, `removed ${filePath}`)
    this.notifyMutation({ action: 'remove_file', name, skillDir: dir, file: target })
    return { ok: true, message: `Support file "${filePath}" removed from "${name}".`, path: target }
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
  private async pruneExpiredArchives(): Promise<void> {
    const archiveRoot = join(this.root, '.archive')
    if (!this.io.mtime) return
    let entries: string[] = []
    try { entries = await this.io.list(archiveRoot) } catch { return }
    const cutoff = Date.now() - ARCHIVE_RETENTION_DAYS * 86_400_000
    for (const entry of entries) {
      const entryPath = join(archiveRoot, entry)
      const mtime = await this.io.mtime(entryPath).catch(() => null)
      if (mtime === null || mtime > cutoff) continue
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
    await this.pruneExpiredArchives()
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
        if (await this.hasWriteLock(this.dirOf(name))) {
          console.warn(`skill-store: snapshot skipped "${name}" — a byte-writer holds its write lock; the skill is recorded as skipped in the manifest`)
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
      const validExtras = extras.filter(extra => SNAPSHOT_EXTRA_NAME_RE.test(extra.name))
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
        extras: Array.isArray(manifest.extras) ? manifest.extras : [],
      }
    } catch {
      return null
    }
  }

  /** Keep only the newest N snapshots (Hermes keep=5 parity); older ones are removed outright. */
  private async retainSnapshots(keep: number): Promise<void> {
    const snapshots = await this.listSnapshots()
    for (const snapshot of snapshots.slice(keep)) {
      try {
        await this.io.remove(snapshot.path)
      } catch {
        // Best-effort pruning: a failed removal must not fail the snapshot itself.
      }
    }
  }

  async listSnapshots(): Promise<Array<{ path: string; createdAt: string; reason: string }>> {
    const backupRoot = join(this.root, '.backups')
    let entries: string[]
    try { entries = await this.io.list(backupRoot) } catch { return [] }
    const out: Array<{ path: string; createdAt: string; reason: string }> = []
    for (const name of entries.sort().reverse()) {
      if (!name.startsWith('skills-')) continue
      const manifest = await this.readSnapshotManifest(join(backupRoot, name))
      if (manifest === null) {
        // v23 (ML-2): a manifest-less/corrupt snapshot used to ESCAPE the
        // retention window entirely (list → skip → never reaped), and each
        // orphan is a full tree+.archive copy. Surface it with an empty
        // createdAt — the sort treats '' as oldest, so retainSnapshots evicts
        // orphans FIRST while a genuinely recent valid snapshot stays ahead.
        out.push({ path: join(backupRoot, name), createdAt: '', reason: 'unreadable or missing manifest (orphan snapshot)' })
        continue
      }
      out.push({ path: join(backupRoot, name), createdAt: manifest.createdAt, reason: manifest.reason })
    }
    // A1-21 (v18): the manifest's createdAt is the authoritative recency
    // (same-millisecond random-suffix names can sort wrongly by name).
    out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.path.localeCompare(a.path))
    return out
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
    const snapshots = await this.listSnapshots()
    const latest = snapshots[0]
    if (!latest) return { ok: false, message: 'No skill snapshot available.' }
    const preRollbackPath = await this.snapshotAll('pre-rollback', extras)
    let skipped: string[] = []
    try {
      // V26-04 (v25): the restore returns the validated manifest's skipped
      // list — no second read that could race retainSnapshots.
      skipped = await this.restoreSnapshotIntoRoot(latest.path)
    } catch (error) {
      // 0.3.16 (E-13): the old shape cleared the active root and then restored
      // with NO protection — a damaged/incomplete snapshot left the tree
      // empty and the caller received a raw rejection. Roll back to the
      // pre-rollback snapshot just taken; if that fails too, name both paths
      // so the operator can rescue by hand.
      const reason = error instanceof Error ? error.message : String(error)
      try {
        await this.restoreSnapshotIntoRoot(preRollbackPath)
        return { ok: false, message: `Snapshot restore failed (${reason}); the active tree was rolled back to the pre-rollback snapshot.` }
      } catch (rollbackError) {
        const rb = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        return { ok: false, message: `Snapshot restore failed (${reason}) AND pre-rollback restore failed (${rb}). Rescue manually from: ${preRollbackPath} (pre-rollback), ${latest.path} (target).` }
      }
    }
    const snapshotExtras = await this.readSnapshotExtras(latest.path)
    // Whole-tree replacement: a single synthetic event invalidates the catalog
    // regardless of how many skills the restore touched (decision C).
    this.notifyMutation({ action: 'restore', name: 'snapshot' })
    // V25-05 (v25): a whole-tree restore brings back exactly `manifest.skills`
    // — skills SKIPPED at snapshot time (live write locks, recorded in
    // `manifest.skipped`) were present in the live tree, are cleared by the
    // restore, and are NOT copied back. Surface them in the result message
    // instead of deleting silently.
    // V26-08 (v25): the recovery hint is HONEST about the mechanism — the
    // pre-rollback snapshot is best-effort and (under a compound lock window)
    // may itself have skipped the same skill, so the message only promises
    // "a copy in .backups if one exists".
    const skippedNote = skipped.length === 0
      ? ''
      : ` NOTE: ${skipped.length} skill(s) were skipped when this snapshot was taken (a live writer held their lock) and are NOT restored: ${skipped.join(', ')} — recover them from .backups if a copy exists.`
    return {
      ok: true,
      message: `Restored skill tree from ${latest.path}.${skippedNote}`,
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
  private async restoreSnapshotIntoRoot(snapshotPath: string): Promise<string[]> {
    // V26-04 (v25): returns the validated manifest's `skipped` list so the
    // caller reuses ONE read (re-reading after the restore raced
    // retainSnapshots and silently dropped the list).
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
    } catch {
      rootEntries = []
    }
    // A1-7 (v18): the snapshot channel has no writer probe in v17. Refuse while
    // a skill writer is active; dead lock residue is swept first so a crashed
    // writer does not block recovery. Root-level sidecar locks are checked the
    // same way (a live `.usage.json.lock` must not be deleted by the clear).
    for (const entry of rootEntries) {
      if (entry === '.archive' || entry === '.backups' || entry === '.mutations.json' || entry === '.curator-suppressed.json') continue
      if (entry.endsWith(LOCK_SUFFIX) || entry.endsWith(`${LOCK_SUFFIX}.next`)) {
        await this.refuseLiveLockOrSweep(join(this.root, entry), entry)
        continue
      }
      const dir = join(this.root, entry)
      if (await this.io.exists(join(dir, 'SKILL.md'))) {
        await this.deleteStrandedLocks(dir)
        if (await this.hasWriteLock(dir)) {
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
    for (const entry of rootEntries) {
      if (entry === '.archive' || entry === '.backups' || entry === '.mutations.json') continue
      if (entry === '.curator-suppressed.json' && restoresSuppressed) continue
      if (entry.endsWith(LOCK_SUFFIX) || entry.endsWith(`${LOCK_SUFFIX}.next`)) continue
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
      await this.deleteStrandedLocks(join(this.root, entry))
    }
    return manifest.skipped
  }
}
