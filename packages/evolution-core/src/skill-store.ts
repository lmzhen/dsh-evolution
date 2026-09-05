/**
 * Skill library management for the self-evolution plugin.
 *
 * Skills live under `$DSH_HOME/skills` (`~/.dsh/skills` by default), matching
 * the default dsh skill-filesystem user root. The plugin only manages skills
 * it created unless a `.hermes-managed` marker opts a skill in. Archival is a
 * move to `.archive/` — never a hard delete.
 */

import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { load as loadYaml } from 'js-yaml'
import { scanContentThreats } from './threats.ts'
import { nodeEvolutionIo, transactIo, type EvolutionIoLike } from './io.ts'
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
  managed: boolean
  archived: boolean
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

/** Restructure targets are plain markdown files under references/ — no subdirectories, no other support kind. */
export const RESTRUCTURE_TARGET_RE = /^references\/[a-z0-9][a-z0-9._-]*\.md$/

/** Extra file name carried inside a snapshot's `extras/` directory. */
export const SNAPSHOT_EXTRA_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/

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
  return join(env.DSH_HOME || join(homedir(), '.dsh'), 'skills')
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
 */
export function normalizeFrontmatter(content: string): FrontmatterNormalizeResult {
  const block = frontmatterBlock(content)
  if (!block) return { content, changed: false, fields: [], issues: [] }
  const { lines, end, nl } = block
  // Detection is shared with the audit side (frontmatterYamlUnsafeValues):
  // normalize and catalog-invalid detection can never disagree.
  const unsafe = new Map(frontmatterYamlUnsafeValues(content).map(entry => [entry.key, entry.value]))
  const originalValues = new Map(unsafe)
  const fields: string[] = []
  const issues: string[] = []
  let changed = false
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    const value = unsafe.get(key ?? '')
    if (key === undefined || value === undefined) continue
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
    fields.push(key)
    changed = true
  }
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
  if (!/^[a-z0-9][a-z0-9-]*$/.test(parsed.frontmatter.name)) return `Invalid skill name "${parsed.frontmatter.name}" — use lowercase letters, digits, and hyphens.`
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

async function listNames(root: string, io: EvolutionIoLike): Promise<string[]> {
  const entries = await io.list(root)
  const names: string[] = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    if (await io.exists(join(root, entry, 'SKILL.md'))) names.push(entry)
  }
  return names.sort()
}

function validateSupportPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.includes('..')) return 'Path traversal is not allowed.'
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0 || !SUPPORT_DIRS.includes(parts[0] as typeof SUPPORT_DIRS[number])) {
    return `file_path must be under one of: ${SUPPORT_DIRS.join(', ')}.`
  }
  if (parts.length < 2) return 'Provide a file name, not just a directory.'
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

/** Trim leading whitespace of the first line and trailing whitespace of the last line. */
function trimPatternBoundaries(pattern: string): string {
  const from = pattern.search(/\S/)
  const trimmed = from < 0 ? pattern : pattern.slice(from)
  const trailing = trimmed.search(/\s+$/)
  return trailing < 0 ? trimmed : trimmed.slice(0, trailing)
}

/** Replace only the fuzzy-matched span, preserving all surrounding bytes. */
function fuzzyReplace(content: string, oldString: string, newString: string, replaceAll: boolean): string {
  let current = content
  let scanFrom = 0
  for (;;) {
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

/** One content write of a tree-change plan; `target` is an absolute path. */
interface TreeChangeWrite {
  target: string
  content: string
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
  /** Semantic validation of the plan (caller context: source existence, mode rules…). */
  validate?: (ctx: { dir: string; currentMd: string | null }) => string | null
  /** Direction-guard mount (R1-1): checked before any write; empty today. */
  preconditions?: Array<(ctx: { dir: string }) => Promise<string | null>>
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

  constructor(
    root = skillsRoot(),
    io: EvolutionIoLike = nodeEvolutionIo(),
    limits: SkillLimits = DEFAULT_SKILL_LIMITS,
    onMutation?: (event: EvolutionSkillMutatedEvent) => void,
    transact?: typeof transactIo,
  ) {
    this.root = root
    this.io = io
    this.limits = limits
    this.onMutation = onMutation
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
    if (this.transact) {
      await this.transact(this.io, path, run)
    } else {
      const current = await this.io.readText(path)
      const next = await run(current)
      if (next !== null && next !== current) await this.io.writeText(path, next)
    }
    const o = outcome as SingleWriteOutcome
    if (o.write !== null && o.audit) {
      await this.audit(o.audit.skillName, o.audit.action, o.audit.before, o.audit.after, o.audit.summary)
    }
    if (o.write !== null && o.event) this.notifyMutation(o.event)
    return o.result
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

  async list(): Promise<SkillSummary[]> {
    const summaries: SkillSummary[] = []
    for (const name of await listNames(this.root, this.io)) {
      const dir = this.dirOf(name)
      const md = await this.io.readText(join(dir, 'SKILL.md'))
      if (!md) continue
      const parsed = parseFrontmatter(md)
      // One directory listing replaces the per-marker exists() probes (P2-6
      // N+1 convergence); the marker set matches deleteProtection(). Names are
      // matched through markerEntryName() so the scan sees exactly the names
      // markerPath() would probe (N-1).
      let entries: string[] = []
      try {
        entries = await this.io.list(dir)
      } catch {
        // A listing failure must not hide the skill; markers report absent.
      }
      const has = (marker: 'bundled' | 'hub-installed' | 'pinned' | 'hermes-managed') => entries.includes(markerEntryName(marker))
      const protectedBy = has('bundled') ? 'bundled' : has('hub-installed') ? 'hub-installed' : has('pinned') ? 'pinned' : null
      summaries.push({
        name,
        description: parsed?.frontmatter.description ?? '',
        path: dir,
        protectedBy,
        managed: has('hermes-managed'),
        archived: false,
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



  /** Name-format guard shared by every path-building mutator/reader. */
  private badName(name: string): string | null {
    const normalized = name.trim()
    if (!SKILL_NAME_RE.test(normalized) || normalized.length > this.limits.maxNameLength) {
      return `Invalid skill name "${normalized}". Use lowercase letters, digits, and hyphens (<= ${this.limits.maxNameLength}).`
    }
    return null
  }

  async writeProtection(rawName: string, origin: WriteOrigin = 'foreground'): Promise<string | null> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

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

  async deleteProtection(rawName: string, options: { allowBundled?: boolean } = {}): Promise<string | null> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

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
    const dir = this.dirOf(rawName)
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
    const normalized = name.trim()
    if (!SKILL_NAME_RE.test(normalized) || normalized.length > this.limits.maxNameLength) {
      return { ok: false, message: `Invalid skill name "${normalized}". Use lowercase letters, digits, and hyphens (<= ${this.limits.maxNameLength}).` }
    }
    if (origin === 'background_review') {
      return { ok: false, message: 'Only the foreground (user or the main agent) may pin or unpin skills.' }
    }
    const dir = this.dirOf(normalized)
    const marker = markerPath(dir, 'pinned')
    const existing = await this.io.exists(marker)
    if (pinned && existing) return { ok: true, message: `Skill "${normalized}" is already pinned.`, path: dir }
    if (!pinned && !existing) return { ok: true, message: `Skill "${normalized}" is not pinned; nothing to do.`, path: dir }
    if (!await this.io.exists(join(dir, 'SKILL.md'))) {
      return { ok: false, message: `Skill "${normalized}" not found.` }
    }
    if (pinned) await this.io.writeText(marker, '')
    else await this.io.remove(marker)
    await this.audit(normalized, pinned ? 'pin' : 'unpin', null, null, pinned ? 'pinned' : 'unpinned')
    return {
      ok: true,
      message: pinned
        ? `Skill "${normalized}" pinned: protected from deletion, background review, and the lifecycle.`
        : `Skill "${normalized}" unpinned.`,
      path: dir,
    }
  }

  async create(name: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    const normalized = name.trim()
    if (!SKILL_NAME_RE.test(normalized) || normalized.length > this.limits.maxNameLength) {
      return { ok: false, message: `Invalid skill name "${normalized}". Use lowercase letters, digits, and hyphens (<= ${this.limits.maxNameLength}).` }
    }
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
    const threat = scanContentThreats(finalContent)
    if (threat) return { ok: false, message: threat }
    const dir = this.dirOf(normalized)
    if (await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${normalized}" already exists.` }
    // F-337: hash the bytes that actually land on disk (write uses
    // trimEnd()+'\n'), so the audit afterHash is replay-identical to the file.
    const onDisk = finalContent.trimEnd() + '\n'
    await this.io.writeText(join(dir, 'SKILL.md'), onDisk)
    // Any non-foreground writer (review channel OR delegated subagent) is an
    // agent-authored skill: mark it managed so the lifecycle owns it.
    if (origin !== 'foreground') {
      await this.io.writeText(markerPath(dir, 'hermes-managed'), '')
    }
    await this.audit(normalized, 'create', null, onDisk, 'created')
    this.notifyMutation({ action: 'create', name: normalized, skillDir: dir })
    return { ok: true, message: `Skill "${normalized}" created.`, path: dir, ...(norm.changed ? { normalizedFrontmatterFields: norm.fields } : {}) }
  }

  async update(rawName: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()
    // F-208: the whole read→validate→write runs under the in-process serialize
    // queue so two concurrent updates on one skill never interleave.
    return await this.serial(() => this.updateCore(name, content, origin))
  }

  private async updateCore(name: string, content: string, origin: WriteOrigin): Promise<SkillActionResult> {
    const dir = this.dirOf(name)
    const path = join(dir, 'SKILL.md')
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
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
    const threat = scanContentThreats(finalContent)
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

      const patched = fuzzyPatch(md, oldString, newString, replaceAll)
      // `null` means "no match"; an empty string is a legitimate replacement.
      if (patched === null) return { result: { ok: false, message: `Could not find old_string in "${name}/${patchLabel}". Use update for a full rewrite.` }, write: null }
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
      const threat = scanContentThreats(writeContent)
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

  async archive(rawName: string, options: ArchiveOptions = {}): Promise<SkillActionResult> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.deleteProtection(name, options.allowBundled === undefined ? {} : { allowBundled: options.allowBundled })
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
    try {
      await this.io.rename(dir, dest)
    } catch {
      // Some IO providers cannot rename across media. Copy the whole tree
      // first so support files are never lost during archival fallback.
      await this.io.copy(dir, dest)
      try {
        await this.io.remove(dir)
      } catch (error) {
        // 0.3.16 (E-14): a failed remove left the skill in BOTH the active
        // root and .archive, and the source was never counted as archived so
        // consolidate rollback would not clean it. Undo the copy we just made;
        // if even that fails, say so instead of rethrowing the remove error.
        const reason = error instanceof Error ? error.message : String(error)
        try {
          await this.io.remove(dest)
          return { ok: false, message: `Archive copy succeeded but the source could not be removed (${reason}); the copied archive was rolled back.` }
        } catch {
          return { ok: false, message: `Archive copy succeeded but the source could not be removed (${reason}) and the archive copy could not be rolled back — the skill now exists in BOTH the active root and .archive; clean up manually.` }
        }
      }
    }
    const reason = options.reason ?? (options.absorbedInto ? `Consolidated into ${options.absorbedInto}` : 'Archived by self-evolution curator')
    await this.io.writeText(join(dest, '.archive-reason'), `${new Date().toISOString()}: ${reason}\n`)
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
      if (!SKILL_NAME_RE.test(name)) return { ok: false, message: `Invalid skill name "${name}". Use lowercase letters, digits, and hyphens.` }
    }
    const targetDir = this.dirOf(targetName)
    const targetMd = await this.io.readText(join(targetDir, 'SKILL.md'))
    if (!targetMd) return { ok: false, message: `Skill "${targetName}" not found.` }
    const targetProtection = await this.writeProtection(targetName, origin)
    if (targetProtection) return { ok: false, message: `Skill "${targetName}" is protected (${targetProtection}).` }
    const writes: TreeChangeWrite[] = []
    if (mode === 'append') {
      const parts: string[] = []
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
      const merged = targetMd.trimEnd() + parts.join('\n') + '\n'
      const validation = validateFrontmatter(merged, targetName, this.limits)
      if (validation) return { ok: false, message: `Consolidation rejected: ${validation}` }
      writes.push({ target: join(targetDir, 'SKILL.md'), content: merged })
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
        writes.push({ target, content: `<!-- demoted from ${source} at ${new Date().toISOString()} -->\n${parsed.body.trim()}\n` })
      }
      // Discoverability: the umbrella's body gains one pointer per demoted source.
      const pointerLines = normalizedSources.map(source => `\n${POINTER_LINE_PREFIX}${source}.md`).join('')
      const extended = targetMd.trimEnd() + pointerLines + '\n'
      const validation = validateFrontmatter(extended, targetName, this.limits)
      if (validation) return { ok: false, message: `Consolidation rejected: ${validation}` }
      writes.push({ target: join(targetDir, 'SKILL.md'), content: extended })
    }
    // Two-phase commit so a failure partway never leaves the tree inconsistent:
    // (1) archive every source first — a source that cannot be archived aborts
    //     before target is touched; (2) only when all sources are safely in
    //     .archive does the kernel commit the writes (byte-level rollback).
    const archived: string[] = []
    try {
      for (const source of normalizedSources) {
        const result = await this.archive(source, { absorbedInto: targetName })
        if (!result.ok) throw new Error(result.message)
        archived.push(source)
      }
      const result = await this.applyTreeChange({
        name: targetName,
        origin,
        protection: 'write',
        writes,
        auditAction: 'consolidate',
        auditSummary: `consolidated ${normalizedSources.join(', ')} (${mode}) into ${targetName}`,
        eventAction: 'consolidate',
      })
      if (!result.ok) throw new Error(result.message)
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
    return { ok: true, message: `Consolidated ${normalizedSources.join(', ')} into "${targetName}".`, path: targetDir }
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
      if (typeof move.heading !== 'string' || !move.heading.trim()) {
        return { ok: false, message: 'Every restructure move needs a non-empty heading.' }
      }
      if (!RESTRUCTURE_TARGET_RE.test(move.toFile)) {
        return { ok: false, message: `toFile must be references/<topic>.md (got "${move.toFile}").` }
      }
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
      })
    }
    writes.push({ target: join(dir, 'SKILL.md'), content: finalMd })
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
    const badName = this.badName(name)
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
    for (const precondition of plan.preconditions ?? []) {
      const issue = await precondition({ dir })
      if (issue) return { ok: false, message: issue }
    }
    // Pre-read EVERY write target: the rollback bytes are kernel-owned and the
    // caller cannot fabricate them. The same read feeds the append semantics of
    // restructure (the caller re-reads for its own construction — kernel reads
    // again because the bytes it restores must be the bytes on disk at commit).
    const landing: Array<{ target: string; content: string; previous: string | null }> = []
    for (const write of plan.writes) {
      const previous = await this.io.readText(write.target).catch(() => null)
      if (Buffer.byteLength(write.content, 'utf8') > this.limits.maxSkillFileBytes) {
        return { ok: false, message: `Write exceeds ${this.limits.maxSkillFileBytes} bytes: ${write.target}` }
      }
      const threat = scanContentThreats(write.content)
      if (threat) return { ok: false, message: threat }
      landing.push({ target: write.target, content: write.content, previous })
    }
    const semantic = plan.validate?.({ dir, currentMd: md }) ?? null
    if (semantic) return { ok: false, message: semantic }
    const written: Array<{ target: string; previous: string | null }> = []
    try {
      for (const entry of landing) {
        await this.io.writeText(entry.target, entry.content)
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
    return { ok: true, message: `${plan.eventAction} "${name}" succeeded.`, path: dir }
  }

  /**
   * Restore one skill from `.archive/` back to the active root. Hermes-style
   * recoverability: archival never deletes, and this is the control-plane
   * path back. The `.archive-reason` marker is dropped on restore.
   */
  async restoreFromArchive(rawName: string): Promise<SkillActionResult> {
    const name = rawName.trim()
    if (!SKILL_NAME_RE.test(name)) return { ok: false, message: `Invalid skill name "${name}". Use lowercase letters, digits, and hyphens.` }
    if (await this.io.exists(join(this.dirOf(name), 'SKILL.md'))) {
      return { ok: false, message: `Skill "${name}" already exists in the active root; refusing to overwrite.` }
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
    const dest = this.dirOf(name)
    // Symlink guard (G7): restoring a symlinked archive entry would recreate a
    // link in the active tree instead of the real content — refuse first.
    if (this.io.isSymlink) {
      const link = await this.io.isSymlink(source)
      if (link === true) return { ok: false, message: `Archived entry "${chosen}" is a symlink; refusing to restore it.` }
    }
    try {
      await this.io.rename(source, dest)
    } catch {
      try {
        await this.io.copy(source, dest)
        await this.io.remove(source)
      } catch (error) {
        // 0.3.16 (E-13 follow-up): the fallback failure must come back as a
        // structured result, never a rejection — consolidates call this in a
        // rollback loop and a throw there would replace the rollback report.
        return { ok: false, message: `Restore of "${name}" from .archive failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    if (await this.io.exists(join(dest, '.archive-reason'))) {
      await this.io.remove(join(dest, '.archive-reason'))
    }
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
    const dir = this.dirOf(name)
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    if (!await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
    if (Buffer.byteLength(content, 'utf8') > this.limits.maxSkillFileBytes) return { ok: false, message: `Support file exceeds ${this.limits.maxSkillFileBytes} bytes.` }
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    return await this.runSingleWrite(target, (current) => {
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
    const before = await this.io.readText(target).catch(() => null)
    await this.io.remove(target)
    await this.audit(name, 'remove_file', before, null, `removed ${filePath}`)
    this.notifyMutation({ action: 'remove_file', name, skillDir: dir, file: target })
    return { ok: true, message: `Support file "${filePath}" removed from "${name}".`, path: target }
  }


  /**
   * Snapshot the recoverable skills state: active tree, usage/suppression
   * sidecars, `.archive/` and caller-supplied extras. `extras` are opaque
   * side files the Snapshot owner cares about (curator state); they are
   * listed in the manifest and only those names are ever read back.
   */
  async snapshotAll(reason = 'pre-mutation', extras: SnapshotExtra[] = []): Promise<string> {
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
    const names = await listNames(this.root, this.io)
    // Parallel copies: snapshot backups touch disjoint directories, and the
    // per-path write locks never contend (P2-6).
    await Promise.all(names.map(async (name) => {
      await this.io.copy(this.dirOf(name), join(dest, name))
    }))
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
    await Promise.all(validExtras.map(async (extra) => {
      await this.io.writeText(join(dest, 'extras', extra.name), extra.content)
    }))
    await this.io.writeText(join(dest, 'manifest.json'), JSON.stringify({
      reason,
      createdAt: new Date().toISOString(),
      skills: names,
      sidecars,
      hasArchive,
      extras: extraNames,
    }, null, 2))
    await this.retainSnapshots(5)
    return dest
  }

  /** Read and normalize a snapshot manifest; null when the file is missing or unparsable. */
  async readSnapshotManifest(path: string): Promise<SnapshotManifest | null> {
    const raw = await this.io.readText(join(path, 'manifest.json'))
    if (raw === null) return null
    try {
      const manifest = JSON.parse(raw) as Partial<SnapshotManifest>
      return {
        reason: typeof manifest.reason === 'string' ? manifest.reason : '',
        createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : '',
        skills: Array.isArray(manifest.skills) ? manifest.skills : [],
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
      if (manifest === null) continue
      out.push({ path: join(backupRoot, name), createdAt: manifest.createdAt, reason: manifest.reason })
    }
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
    return {
      ok: true,
      message: `Restored skill tree from ${latest.path}`,
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
    let rootEntries: string[]
    try {
      rootEntries = await this.io.list(this.root)
    } catch {
      rootEntries = []
    }
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
    for (const entry of rootEntries) {
      if (entry === '.archive' || entry === '.backups' || entry === '.mutations.json' || entry === '.curator-suppressed.json') continue
      await this.io.remove(join(this.root, entry))
    }
    const manifest = await this.readSnapshotManifest(snapshotPath)
    if (manifest === null) {
      // Legacy snapshot without a readable manifest: restore every entry
      // except the manifest and extras (extras are owner state, never
      // skills-root content).
      for (const entry of await this.io.list(snapshotPath)) {
        if (entry === 'manifest.json' || entry === 'extras') continue
        await this.io.copy(join(snapshotPath, entry), join(this.root, entry))
      }
    } else {
      for (const name of manifest.skills) {
        await this.io.copy(join(snapshotPath, name), join(this.root, name))
      }
      for (const sidecar of manifest.sidecars) {
        await this.io.copy(join(snapshotPath, sidecar), join(this.root, sidecar))
      }
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
  }
}
