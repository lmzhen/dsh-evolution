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
import { scanContentThreats } from './threats.ts'
import { nodeEvolutionIo, type EvolutionIoLike } from './io.ts'
import { contentHash, loadMutations, recordMutation, type MutationRecord } from './mutations.ts'
import { suppressedFile, usageFile } from './usage.ts'
import { MAX_SKILL_NAME_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_SKILL_CONTENT_CHARS, MAX_SKILL_FILE_BYTES, SKILL_NAME_RE, SUPPORT_DIRS } from './constants.ts'
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
}

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
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'skills')
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
 * poisoning every protectedBy/managed report). */
function markerEntryName(marker: 'bundled' | 'hub-installed' | 'pinned' | 'hermes-managed'): string {
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

export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } | null {
  if (!content.trimStart().startsWith('---')) return null
  const end = content.indexOf('\n---', 3)
  if (end < 0) return null
  const block = content.slice(3, end)
  const body = content.slice(end + 4).trim()
  if (!body) return null
  const frontmatter: Frontmatter = {}
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match) {
      const [, key, value] = match
      if (key && value !== undefined) frontmatter[key] = value.trim().replace(/^["']|["']$/g, '')
    }
  }
  return { frontmatter, body }
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
  for (const match of Array.from(raw.matchAll(/[a-z0-9][a-z0-9-]*/g))) {
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
  if (content.length > limits.maxSkillContentChars) return `SKILL.md content exceeds ${limits.maxSkillContentChars} characters.`
  return null
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
    return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
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
      return patched === content ? null : patched
    }
  }
  // Stage 2: whitespace-plus-escape tolerance (pattern `\n`/`\t`/`\r` literals
  // match real characters, runs match runs); replacement lands on the span
  // only, so file indentation/formatting survives.
  if (fuzzyIndexOf(content, oldString) !== null) {
    const patched = fuzzyReplace(content, oldString, newString, replaceAll)
    return patched === content ? null : patched
  }
  return null
}

export class SkillLibrary {
  readonly root: string
  readonly limits: SkillLimits
  private readonly io: EvolutionIoLike
  private readonly onMutation: ((event: EvolutionSkillMutatedEvent) => void) | undefined

  constructor(
    root = skillsRoot(),
    io: EvolutionIoLike = nodeEvolutionIo(),
    limits: SkillLimits = DEFAULT_SKILL_LIMITS,
    onMutation?: (event: EvolutionSkillMutatedEvent) => void,
  ) {
    this.root = root
    this.io = io
    this.limits = limits
    this.onMutation = onMutation
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
    return this.io.readText(join(this.dirOf(name), 'SKILL.md'))
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
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
    const dir = this.dirOf(normalized)
    if (await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${normalized}" already exists.` }
    await this.io.writeText(join(dir, 'SKILL.md'), content.trimEnd() + '\n')
    // Any non-foreground writer (review channel OR delegated subagent) is an
    // agent-authored skill: mark it managed so the lifecycle owns it.
    if (origin !== 'foreground') {
      await this.io.writeText(markerPath(dir, 'hermes-managed'), '')
    }
    await this.audit(normalized, 'create', null, content, 'created')
    this.notifyMutation({ action: 'create', name: normalized, filePath: dir })
    return { ok: true, message: `Skill "${normalized}" created.`, path: dir }
  }

  async update(rawName: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = this.dirOf(name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name, origin)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateFrontmatter(content, name, this.limits)
    if (validation) return { ok: false, message: validation }
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
    await this.io.writeText(join(dir, 'SKILL.md'), content.trimEnd() + '\n')
    await this.audit(name, 'update', md, content, 'updated')
    this.notifyMutation({ action: 'update', name, filePath: dir })
    return { ok: true, message: `Skill "${name}" updated.`, path: dir }
  }

  async patch(rawName: string, oldString: string, newString: string, filePath = '', replaceAll = false, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {

    // One trim per entry: paths (dirOf), validation and messages all see the same name.
    const name = rawName.trim()

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
    const md = await this.io.readText(target)
    if (!md) return { ok: false, message: `File not found: ${patchLabel}` }

    const patched = fuzzyPatch(md, oldString, newString, replaceAll)
    // `null` means "no match"; an empty string is a legitimate replacement.
    if (patched === null) return { ok: false, message: `Could not find old_string in "${name}/${patchLabel}". Use update for a full rewrite.` }
    if (target === skillMd) {
      const validation = validateFrontmatter(patched, name, this.limits)
      if (validation) return { ok: false, message: `Patch rejected: ${validation}` }
    }
    if (Buffer.byteLength(patched, 'utf8') > this.limits.maxSkillFileBytes && target !== skillMd) {
      return { ok: false, message: `Patched file exceeds ${this.limits.maxSkillFileBytes} bytes.` }
    }
    if (patched.length > this.limits.maxSkillContentChars && target === skillMd) {
      return { ok: false, message: `Patched content exceeds ${this.limits.maxSkillContentChars} characters.` }
    }
    const threat = scanContentThreats(patched)
    if (threat) return { ok: false, message: threat }
    await this.io.writeText(target, patched.trimEnd() + '\n')
    await this.audit(name, 'patch', md, patched, `patched ${patchLabel}`)
    this.notifyMutation({ action: 'patch', name, filePath: dir })
    return { ok: true, message: `Skill "${name}" patched (${patchLabel}).`, path: dir }
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
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    if (options.absorbedInto) {
      const target = await this.io.readText(join(this.dirOf(options.absorbedInto), 'SKILL.md'))
      if (!target) return { ok: false, message: `absorbed_into="${options.absorbedInto}" does not exist.` }
    }
    const archiveRoot = join(this.root, '.archive')
    let dest = join(archiveRoot, name.trim())
    if (await this.io.exists(dest)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      dest = join(archiveRoot, `${name.trim()}-${stamp}`)
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
      await this.io.remove(dir)
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
   */
  async consolidate(target: string, sources: string[], origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    // Names normalize before validation (rc.42 audit P2-5): the trimmed form    // is what every path-building call below resolves to, so validation and    // IO can never disagree about which skill is meant.    const targetName = target.trim()    const normalizedSources = [...new Set(sources.map(name => name.trim()))].filter(name => name !== targetName)
    if (normalizedSources.length === 0) return { ok: false, message: 'Consolidation requires at least one distinct source skill.' }
    for (const name of [targetName, ...normalizedSources]) {
      if (!SKILL_NAME_RE.test(name)) return { ok: false, message: `Invalid skill name "${name}". Use lowercase letters, digits, and hyphens.` }
    }
    const targetDir = this.dirOf(targetName)
    const targetMd = await this.io.readText(join(targetDir, 'SKILL.md'))
    if (!targetMd) return { ok: false, message: `Skill "${targetName}" not found.` }
    const targetProtection = await this.writeProtection(targetName, origin)
    if (targetProtection) return { ok: false, message: `Skill "${targetName}" is protected (${targetProtection}).` }
    const parts: string[] = []
    for (const source of normalizedSources) {
      const protection = await this.deleteProtection(source)
      if (protection) return { ok: false, message: `Skill "${source}" is protected (${protection}).` }
      const sourceMd = await this.io.readText(join(this.dirOf(source), 'SKILL.md'))
      if (!sourceMd) return { ok: false, message: `Skill "${source}" not found.` }
      const parsed = parseFrontmatter(sourceMd)
      if (!parsed) return { ok: false, message: `Skill "${source}" has no valid frontmatter; refusing to merge.` }
      parts.push(`\n<!-- consolidated from ${source} at ${new Date().toISOString()} -->\n${parsed.body.trim()}`)
    }
    const merged = targetMd.trimEnd() + parts.join('\n') + '\n'
    const validation = validateFrontmatter(merged, targetName, this.limits)
    if (validation) return { ok: false, message: `Consolidation rejected: ${validation}` }
    const threat = scanContentThreats(merged)
    if (threat) return { ok: false, message: threat }
    // Two-phase commit so a failure partway never leaves the tree inconsistent:
    // (1) archive every source first — a source that cannot be archived aborts
    //     before target is touched; (2) only when all sources are safely in
    //     .archive do we write the merged target. Any failure — including a
    //     refused archive mid-loop (rc.42 audit P1-1: an early `return` here
    //     skipped the rollback and left earlier sources consumed) — goes
    //     through the catch, which restores the target and un-archives every
    //     already-moved source.
    const archived: string[] = []
    try {
      for (const source of normalizedSources) {
        const result = await this.archive(source, { absorbedInto: targetName })
        if (!result.ok) throw new Error(result.message)
        archived.push(source)
      }
      await this.io.writeText(join(targetDir, 'SKILL.md'), merged)
    } catch (error) {
      // Restore the target that we may have (partially) overwritten.
      await this.io.writeText(join(targetDir, 'SKILL.md'), targetMd).catch(() => {})
      // Bring back any source we already archived so the merge is fully undone.
      for (const source of archived.reverse()) {
        await this.restoreFromArchive(source).catch(() => {})
      }
      return { ok: false, message: `Consolidation failed and was rolled back: ${error instanceof Error ? error.message : String(error)}` }
    }
    this.notifyMutation({ action: 'consolidate', name: targetName, filePath: targetDir })
    return { ok: true, message: `Consolidated ${normalizedSources.join(', ')} into "${targetName}".`, path: targetDir }
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
    const candidates = entries.filter(entry => entry === name || entry.startsWith(`${name}-`)).sort().reverse()
    const chosen = candidates[0]
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
      await this.io.copy(source, dest)
      await this.io.remove(source)
    }
    if (await this.io.exists(join(dest, '.archive-reason'))) {
      await this.io.remove(join(dest, '.archive-reason'))
    }
    this.notifyMutation({ action: 'restore', name, filePath: dest })
    return { ok: true, message: `Skill "${name}" restored from .archive.`, path: dest }
  }

  async writeSupportFile(rawName: string, filePath: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {

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
    if (Buffer.byteLength(content, 'utf8') > this.limits.maxSkillFileBytes) return { ok: false, message: `Support file exceeds ${this.limits.maxSkillFileBytes} bytes.` }
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    const existing = await this.io.readText(target).catch(() => null)
    await this.io.writeText(target, content)
    await this.audit(name, 'write_file', existing, content, `wrote ${filePath}`)
    this.notifyMutation({ action: 'write_file', name, filePath: target })
    return { ok: true, message: `Support file "${filePath}" written to "${name}".`, path: target }
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
    this.notifyMutation({ action: 'remove_file', name, filePath: target })
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

  /** Keep only the newest N snapshots (Hermes keep=5 parity); oldest folded into .backups history. */
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
    await this.snapshotAll('pre-rollback', extras)
    // Whole-tree replacement (rc.50 P2-14): the manifest is the only restore
    // authority, so every NON-system entry in the active root is cleared first
    // — a stray directory the manifest never declared must not survive a
    // restore. System entries (sidecars/.archive/.backups, all dot-prefixed)
    // are untouched here and restored/reconciled by the manifest below. The
    // same clear runs for legacy manifests: their "restore everything" branch
    // below repopulates from the snapshot, so no entry is lost either way.
    let rootEntries: string[]
    try {
      rootEntries = await this.io.list(this.root)
    } catch {
      rootEntries = []
    }
    for (const entry of rootEntries) {
      if (entry.startsWith('.')) continue
      await this.io.remove(join(this.root, entry))
    }
    const manifest = await this.readSnapshotManifest(latest.path)
    if (manifest === null) {
      // Legacy snapshot without a readable manifest: restore every entry
      // except the manifest and extras (extras are owner state, never
      // skills-root content).
      for (const entry of await this.io.list(latest.path)) {
        if (entry === 'manifest.json' || entry === 'extras') continue
        await this.io.copy(join(latest.path, entry), join(this.root, entry))
      }
    } else {
      for (const name of manifest.skills) {
        await this.io.copy(join(latest.path, name), join(this.root, name))
      }
      for (const sidecar of manifest.sidecars) {
        await this.io.copy(join(latest.path, sidecar), join(this.root, sidecar))
      }
      // Archive is part of the whole-state rollback: a snapshot that carried
      // `.archive/` replaces the current one; a snapshot with no archive
      // means the archive content post-dates it, so it is rolled away too
      // (the pre-rollback snapshot above preserved it). Legacy manifests
      // without the field leave `.archive` untouched.
      const archiveRoot = join(this.root, '.archive')
      if (manifest.hasArchive === true) {
        await this.io.remove(archiveRoot)
        await this.io.copy(join(latest.path, '.archive'), archiveRoot)
      } else if (manifest.hasArchive === false) {
        await this.io.remove(archiveRoot)
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
}
