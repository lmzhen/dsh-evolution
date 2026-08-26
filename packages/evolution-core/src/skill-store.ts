/**
 * Skill library management for the self-evolution plugin.
 *
 * Skills live under `$DSH_HOME/skills` (`~/.dsh/skills` by default), matching
 * the default dsh skill-filesystem user root. The plugin only manages skills
 * it created unless a `.hermes-managed` marker opts a skill in. Archival is a
 * move to `.archive/` — never a hard delete.
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { scanContentThreats } from './threats.ts'
import { nodeEvolutionIo, type EvolutionIoLike } from './io.ts'
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

export function skillsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'skills')
}

function skillDir(root: string, name: string): string {
  return join(root, name)
}

function markerPath(dir: string, marker: 'bundled' | 'hub-installed' | 'pinned' | 'hermes-managed' | 'hermes-exempt'): string {
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

function fuzzyPatch(content: string, oldString: string, newString: string, replaceAll = false): string | null {
  if (content.includes(oldString)) {
    return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
  }
  const trimmed = content.replaceAll(/[ 	]+$/gm, '')
  if (trimmed.includes(oldString)) return trimmed.replace(oldString, newString)
  const whitespace = content.replaceAll(/[ 	]+/g, ' ')
  if (whitespace.includes(oldString)) return whitespace.replace(oldString, newString)
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
    return this.io.readText(join(skillDir(this.root, name), 'SKILL.md'))
  }

  async writeProtection(name: string): Promise<string | null> {
    const dir = skillDir(this.root, name)
    for (const marker of ['bundled', 'hub-installed'] as const) {
      if (await this.io.exists(markerPath(dir, marker))) return marker
    }
    return null
  }

  async deleteProtection(name: string): Promise<string | null> {
    const dir = skillDir(this.root, name)
    for (const marker of ['bundled', 'hub-installed', 'pinned'] as const) {
      if (await this.io.exists(markerPath(dir, marker))) return marker
    }
    return null
  }

  async isManaged(name: string): Promise<boolean> {
    const dir = skillDir(this.root, name)
    return await this.io.exists(markerPath(dir, 'hermes-managed'))
  }

  async create(name: string, content: string, origin: 'foreground' | 'background_review'): Promise<SkillActionResult> {
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
    if (origin === 'background_review') {
      await this.io.writeText(markerPath(dir, 'hermes-managed'), '')
    }
    return { ok: true, message: `Skill "${normalized}" created.`, path: dir }
  }

  async update(name: string, content: string): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateFrontmatter(content, name, this.limits)
    if (validation) return { ok: false, message: validation }
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
    await this.io.writeText(join(dir, 'SKILL.md'), content.trimEnd() + '\n')
    return { ok: true, message: `Skill "${name}" updated.`, path: dir }
  }

  async patch(name: string, oldString: string, newString: string, filePath = '', replaceAll = false): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    const skillMd = join(dir, 'SKILL.md')
    if (!await this.io.exists(skillMd)) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name)
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
    return { ok: true, message: `Skill "${name}" patched (${patchLabel}).`, path: dir }
  }

  async archive(name: string, absorbedInto = ''): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    const md = await this.io.readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.deleteProtection(name)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    if (absorbedInto) {
      const target = await this.io.readText(join(skillDir(this.root, absorbedInto), 'SKILL.md'))
      if (!target) return { ok: false, message: `absorbed_into="${absorbedInto}" does not exist.` }
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
    const reason = absorbedInto ? `Consolidated into ${absorbedInto}` : 'Archived by self-evolution curator'
    await this.io.writeText(join(dest, '.archive-reason'), `${new Date().toISOString()}: ${reason}\n`)
    return { ok: true, message: `Skill "${name}" archived to .archive.`, path: dest }
  }

  /**
   * Merge the bodies of `sources` into `target` and archive the sources with
   * an absorbed-into marker. Hermes-style consolidation: overlapping skills
   * collapse into one, and the originals stay recoverable under `.archive/`.
   */
  async consolidate(target: string, sources: string[]): Promise<SkillActionResult> {
    const normalizedSources = [...new Set(sources)].filter(name => name !== target)
    if (normalizedSources.length === 0) return { ok: false, message: 'Consolidation requires at least one distinct source skill.' }
    for (const name of [target, ...normalizedSources]) {
      if (!SKILL_NAME_RE.test(name)) return { ok: false, message: `Invalid skill name "${name}". Use lowercase letters, digits, and hyphens.` }
    }
    const targetDir = skillDir(this.root, target)
    const targetMd = await this.io.readText(join(targetDir, 'SKILL.md'))
    if (!targetMd) return { ok: false, message: `Skill "${target}" not found.` }
    const targetProtection = await this.writeProtection(target)
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
        const result = await this.archive(source, target)
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

  async writeSupportFile(name: string, filePath: string, content: string): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    if (!await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
    if (Buffer.byteLength(content, 'utf8') > this.limits.maxSkillFileBytes) return { ok: false, message: `Support file exceeds ${this.limits.maxSkillFileBytes} bytes.` }
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    await this.io.writeText(target, content)
    return { ok: true, message: `Support file "${filePath}" written to "${name}".`, path: target }
  }

  async removeSupportFile(name: string, filePath: string): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    if (!await this.io.exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
    const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    if (!await this.io.exists(target)) return { ok: false, message: `File "${filePath}" not found in skill "${name}".` }
    await this.io.remove(target)
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
    await this.io.writeText(join(dest, 'manifest.json'), JSON.stringify({ reason, createdAt: new Date().toISOString(), skills: names }, null, 2))
    return dest
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
      await this.io.copy(join(latest.path, entry), join(this.root, entry))
    }
    return { ok: true, message: `Restored skill tree from ${latest.path}`, path: latest.path }
  }
}
