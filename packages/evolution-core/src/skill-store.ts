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

function skillDir(root: string, name: string): string {
  return join(root, name)
}

function markerPath(dir: string, marker: 'bundled' | 'hub-installed' | 'pinned' | 'hermes-managed'): string {
  return join(dir, `.${marker}`)
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
function fuzzyIndexOf(content: string, pattern: string): [number, number] | null {
  const isSpace = (char: string | undefined) => char !== undefined && /[ \t]/.test(char)
  const escaped = (char: string | undefined): string | null => {
    if (char === 'n') return '\n'
    if (char === 't') return '\t'
    if (char === 'r') return '\r'
    return null
  }
  for (let start = 0; start < content.length; start += 1) {
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
  const match = fuzzyIndexOf(content, oldString)
  if (match === null) return content
  const [start, end] = match
  const patched = content.slice(0, start) + newString + content.slice(end)
  return replaceAll ? fuzzyReplace(patched, oldString, newString, true) : patched
}

function fuzzyPatch(content: string, oldString: string, newString: string, replaceAll = false): string | null {
  if (content.includes(oldString)) {
    return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
  }
  // Stage 1: boundary trim — the model often cites a line with its leading
  // indent (or a trailing space); trimming only the pattern's first/last line
  // keeps the replacement span on the real text without touching other bytes.
  const boundary = trimPatternBoundaries(oldString)
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

  constructor(root = skillsRoot(), io: EvolutionIoLike = nodeEvolutionIo(), limits: SkillLimits = DEFAULT_SKILL_LIMITS) {
    this.root = root
    this.io = io
    this.limits = limits
  }

  async list(): Promise<SkillSummary[]> {
    const summaries: SkillSummary[] = []
    for (const name of await listNames(this.root, this.io)) {
      const dir = skillDir(this.root, name)
      const md = await this.io.readText(join(dir, 'SKILL.md'))
      if (!md) continue
      const parsed = parseFrontmatter(md)
      const protectedBy = await this.deleteProtection(name)
      const managed = await this.io.exists(markerPath(dir, 'hermes-managed'))
      summaries.push({
        name,
        description: parsed?.frontmatter.description ?? '',
        path: dir,
        protectedBy,
        managed,
        archived: false,
      })
    }
    return summaries
  }

  async read(name: string): Promise<string | null> {
    // Defensive: an invalid name must never escape the skills root via join().
    if (this.badName(name) !== null) return null
    return this.io.readText(join(skillDir(this.root, name), 'SKILL.md'))
  }

  /** Name-format guard shared by every path-building mutator/reader. */
  private badName(name: string): string | null {
    const normalized = name.trim()
    if (!SKILL_NAME_RE.test(normalized) || normalized.length > this.limits.maxNameLength) {
      return `Invalid skill name "${normalized}". Use lowercase letters, digits, and hyphens (<= ${this.limits.maxNameLength}).`
    }
    return null
  }

  async writeProtection(name: string, origin: WriteOrigin = 'foreground'): Promise<string | null> {
    const dir = skillDir(this.root, name)
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

  async deleteProtection(name: string, options: { allowBundled?: boolean } = {}): Promise<string | null> {
    const dir = skillDir(this.root, name)
    const markers: ReadonlyArray<'bundled' | 'hub-installed' | 'pinned'> = options.allowBundled
      ? ['hub-installed', 'pinned']
      : ['bundled', 'hub-installed', 'pinned']
    for (const marker of markers) {
      if (await this.io.exists(markerPath(dir, marker))) return marker
    }
    return null
  }

  async isManaged(name: string): Promise<boolean> {
    const dir = skillDir(this.root, name)
    return await this.io.exists(markerPath(dir, 'hermes-managed'))
  }

  /** Whether the skill carries the bundled marker (curator prune-builtins eligibility). */
  async isBundled(name: string): Promise<boolean> {
    if (this.badName(name) !== null) return false
    const dir = skillDir(this.root, name)
    return await this.io.exists(markerPath(dir, 'bundled'))
  }

  /** Whether the skill carries the pinned marker (the marker is the factual source; usage.pinned mirrors it). */
  async isPinned(name: string): Promise<boolean> {
    if (this.badName(name) !== null) return false
    const dir = skillDir(this.root, name)
    return await this.io.exists(markerPath(dir, 'pinned'))
  }

  /** Count non-empty support subdirectories (richness input for quality scoring). */
  async countSupportDirs(name: string): Promise<number> {
    if (this.badName(name) !== null) return 0
    const dir = skillDir(this.root, name)
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
    const dir = skillDir(this.root, normalized)
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
    const dir = skillDir(this.root, normalized)
    if (await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${normalized}" already exists.` }
    await this.io.writeText(join(dir, 'SKILL.md'), content.trimEnd() + '\n')
    // Any non-foreground writer (review channel OR delegated subagent) is an
    // agent-authored skill: mark it managed so the lifecycle owns it.
    if (origin !== 'foreground') {
      await this.io.writeText(markerPath(dir, 'hermes-managed'), '')
    }
    await this.audit(normalized, 'create', null, content, 'created')
    return { ok: true, message: `Skill "${normalized}" created.`, path: dir }
  }

  async update(name: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = skillDir(this.root, name)
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
    return { ok: true, message: `Skill "${name}" updated.`, path: dir }
  }

  async patch(name: string, oldString: string, newString: string, filePath = '', replaceAll = false, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = skillDir(this.root, name)
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
    if (!patched) return { ok: false, message: `Could not find old_string in "${name}/${patchLabel}". Use update for a full rewrite.` }
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
    return { ok: true, message: `Skill "${name}" patched (${patchLabel}).`, path: dir }
  }

  async archive(name: string, options: ArchiveOptions = {}): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = skillDir(this.root, name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.deleteProtection(name, options.allowBundled === undefined ? {} : { allowBundled: options.allowBundled })
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    if (options.absorbedInto) {
      const target = await this.io.readText(join(skillDir(this.root, options.absorbedInto), 'SKILL.md'))
      if (!target) return { ok: false, message: `absorbed_into="${options.absorbedInto}" does not exist.` }
    }
    const archiveRoot = join(this.root, '.archive')
    let dest = join(archiveRoot, name)
    if (await this.io.exists(dest)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      dest = join(archiveRoot, `${name}-${stamp}`)
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
    return { ok: true, message: `Skill "${name}" archived to .archive.`, path: dest }
  }

  /**
   * Merge the bodies of `sources` into `target` and archive the sources with
   * an absorbed-into marker. Hermes-style consolidation: overlapping skills
   * collapse into one, and the originals stay recoverable under `.archive/`.
   */
  async consolidate(target: string, sources: string[], origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    const normalizedSources = [...new Set(sources)].filter(name => name !== target)
    if (normalizedSources.length === 0) return { ok: false, message: 'Consolidation requires at least one distinct source skill.' }
    for (const name of [target, ...normalizedSources]) {
      if (!SKILL_NAME_RE.test(name)) return { ok: false, message: `Invalid skill name "${name}". Use lowercase letters, digits, and hyphens.` }
    }
    const targetDir = skillDir(this.root, target)
    const targetMd = await this.io.readText(join(targetDir, 'SKILL.md'))
    if (!targetMd) return { ok: false, message: `Skill "${target}" not found.` }
    const targetProtection = await this.writeProtection(target, origin)
    if (targetProtection) return { ok: false, message: `Skill "${target}" is protected (${targetProtection}).` }
    const parts: string[] = []
    for (const source of normalizedSources) {
      const protection = await this.deleteProtection(source)
      if (protection) return { ok: false, message: `Skill "${source}" is protected (${protection}).` }
      const sourceMd = await this.io.readText(join(skillDir(this.root, source), 'SKILL.md'))
      if (!sourceMd) return { ok: false, message: `Skill "${source}" not found.` }
      const parsed = parseFrontmatter(sourceMd)
      if (!parsed) return { ok: false, message: `Skill "${source}" has no valid frontmatter; refusing to merge.` }
      parts.push(`\n<!-- consolidated from ${source} at ${new Date().toISOString()} -->\n${parsed.body.trim()}`)
    }
    const merged = targetMd.trimEnd() + parts.join('\n') + '\n'
    const validation = validateFrontmatter(merged, target, this.limits)
    if (validation) return { ok: false, message: `Consolidation rejected: ${validation}` }
    const threat = scanContentThreats(merged)
    if (threat) return { ok: false, message: threat }
    // Two-phase commit so a failure partway never leaves the tree inconsistent:
    // (1) archive every source first — a source that cannot be archived aborts
    //     before target is touched; (2) only when all sources are safely in
    //     .archive do we write the merged target. If the target write itself
    //     fails, roll the archived sources back so nothing was consumed.
    const archived: string[] = []
    try {
      for (const source of normalizedSources) {
        const result = await this.archive(source, { absorbedInto: target })
        if (!result.ok) return result
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
    return { ok: true, message: `Consolidated ${normalizedSources.join(', ')} into "${target}".`, path: targetDir }
  }

  /**
   * Restore one skill from `.archive/` back to the active root. Hermes-style
   * recoverability: archival never deletes, and this is the control-plane
   * path back. The `.archive-reason` marker is dropped on restore.
   */
  async restoreFromArchive(name: string): Promise<SkillActionResult> {
    if (!SKILL_NAME_RE.test(name)) return { ok: false, message: `Invalid skill name "${name}". Use lowercase letters, digits, and hyphens.` }
    if (await this.io.exists(join(skillDir(this.root, name), 'SKILL.md'))) {
      return { ok: false, message: `Skill "${name}" already exists in the active root; refusing to overwrite.` }
    }
    const archiveRoot = join(this.root, '.archive')
    let entries: string[]
    try { entries = await this.io.list(archiveRoot) } catch { return { ok: false, message: 'No skill archive available.' } }
    const candidates = entries.filter(entry => entry === name || entry.startsWith(`${name}-`)).sort().reverse()
    const chosen = candidates[0]
    if (!chosen) return { ok: false, message: `Skill "${name}" is not in .archive.` }
    const source = join(archiveRoot, chosen)
    const dest = skillDir(this.root, name)
    try {
      await this.io.rename(source, dest)
    } catch {
      await this.io.copy(source, dest)
      await this.io.remove(source)
    }
    if (await this.io.exists(join(dest, '.archive-reason'))) {
      await this.io.remove(join(dest, '.archive-reason'))
    }
    return { ok: true, message: `Skill "${name}" restored from .archive.`, path: dest }
  }

  async writeSupportFile(name: string, filePath: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = skillDir(this.root, name)
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
    return { ok: true, message: `Support file "${filePath}" written to "${name}".`, path: target }
  }

  async removeSupportFile(name: string, filePath: string, origin: WriteOrigin = 'foreground'): Promise<SkillActionResult> {
    const badName = this.badName(name)
    if (badName) return { ok: false, message: badName }
    const dir = skillDir(this.root, name)
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
    return { ok: true, message: `Support file "${filePath}" removed from "${name}".`, path: target }
  }


  async snapshotAll(reason = 'pre-mutation'): Promise<string> {
    const backupRoot = join(this.root, '.backups')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(backupRoot, `skills-${stamp}`)
    const names = await listNames(this.root, this.io)
    for (const name of names) {
      await this.io.copy(skillDir(this.root, name), join(dest, name))
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
    await this.io.writeText(join(dest, 'manifest.json'), JSON.stringify({ reason, createdAt: new Date().toISOString(), skills: names, sidecars }, null, 2))
    await this.retainSnapshots(5)
    return dest
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
      try {
        const raw = await this.io.readText(join(backupRoot, name, 'manifest.json'))
        if (raw === null) continue
        const manifest = JSON.parse(raw) as { createdAt?: string; reason?: string }
        out.push({ path: join(backupRoot, name), createdAt: manifest.createdAt ?? '', reason: manifest.reason ?? '' })
      } catch { /* skip */ }
    }
    return out
  }

  async restoreLatestSnapshot(): Promise<SkillActionResult> {
    const snapshots = await this.listSnapshots()
    const latest = snapshots[0]
    if (!latest) return { ok: false, message: 'No skill snapshot available.' }
    await this.snapshotAll('pre-rollback')
    for (const name of await listNames(this.root, this.io)) {
      await this.io.remove(skillDir(this.root, name))
    }
    const entries = await this.io.list(latest.path)
    for (const entry of entries) {
      if (entry === 'manifest.json') continue
      // Sidecars (usage/suppression) live in the snapshot root alongside the
      // skill dirs, so this loop restores them too.
      await this.io.copy(join(latest.path, entry), join(this.root, entry))
    }
    return { ok: true, message: `Restored skill tree from ${latest.path}`, path: latest.path }
  }
}
