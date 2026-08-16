/**
 * Skill library management for the self-evolution plugin.
 *
 * Skills live under `$DSH_HOME/skills` (`~/.dsh/skills` by default), matching
 * the default dsh skill-filesystem user root. The plugin only manages skills
 * it created unless a `.hermes-managed` marker opts a skill in. Archival is a
 * move to `.archive/` — never a hard delete.
 */

import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { scanContentThreats } from './threats.ts'

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
export const MAX_SKILL_NAME_LENGTH = 64
export const MAX_DESCRIPTION_LENGTH = 1024
export const MAX_SKILL_CONTENT_CHARS = 100_000
export const MAX_SKILL_FILE_BYTES = 1_048_576
export const SUPPORT_DIRS = ['references', 'templates', 'scripts', 'assets'] as const

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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
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
    if (match) frontmatter[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, '')
  }
  return { frontmatter, body }
}

export function validateFrontmatter(content: string, expectedName?: string): string | null {
  const parsed = parseFrontmatter(content)
  if (!parsed) return 'SKILL.md must start and end with YAML frontmatter and include a body.'
  if (!parsed.frontmatter.name) return 'Frontmatter must include a name field.'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(parsed.frontmatter.name)) return `Invalid skill name "${parsed.frontmatter.name}" — use lowercase letters, digits, and hyphens.`
  if (parsed.frontmatter.name.length > MAX_SKILL_NAME_LENGTH) return `Skill name exceeds ${MAX_SKILL_NAME_LENGTH} characters.`
  if (expectedName && parsed.frontmatter.name !== expectedName) return `Frontmatter name "${parsed.frontmatter.name}" does not match target skill "${expectedName}".`
  if (!parsed.frontmatter.description) return 'Frontmatter must include a description field.'
  const description = String(parsed.frontmatter.description)
  if (description.length > MAX_DESCRIPTION_LENGTH) return `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`
  if (content.length > MAX_SKILL_CONTENT_CHARS) return `SKILL.md content exceeds ${MAX_SKILL_CONTENT_CHARS} characters.`
  return null
}

async function listNames(root: string): Promise<string[]> {
  await mkdir(root, { recursive: true })
  const entries = await readdir(root, { withFileTypes: true })
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (await exists(join(root, entry.name, 'SKILL.md'))) names.push(entry.name)
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

  constructor(root = skillsRoot()) {
    this.root = root
  }

  async list(): Promise<SkillSummary[]> {
    const summaries: SkillSummary[] = []
    for (const name of await listNames(this.root)) {
      const dir = skillDir(this.root, name)
      const md = await readText(join(dir, 'SKILL.md'))
      if (!md) continue
      const parsed = parseFrontmatter(md)
      const protectedBy = await this.deleteProtection(name)
      const managed = await exists(markerPath(dir, 'hermes-managed'))
      summaries.push({
        name,
        description: parsed?.frontmatter.description ? String(parsed.frontmatter.description) : '',
        path: dir,
        protectedBy,
        managed,
        archived: false,
      })
    }
    return summaries
  }

  async read(name: string): Promise<string | null> {
    return readText(join(skillDir(this.root, name), 'SKILL.md'))
  }

  async writeProtection(name: string): Promise<string | null> {
    const dir = skillDir(this.root, name)
    for (const marker of ['bundled', 'hub-installed'] as const) {
      if (await exists(markerPath(dir, marker))) return marker
    }
    return null
  }

  async deleteProtection(name: string): Promise<string | null> {
    const dir = skillDir(this.root, name)
    for (const marker of ['bundled', 'hub-installed', 'pinned'] as const) {
      if (await exists(markerPath(dir, marker))) return marker
    }
    return null
  }

  async isManaged(name: string): Promise<boolean> {
    const dir = skillDir(this.root, name)
    return await exists(markerPath(dir, 'hermes-managed'))
  }

  async create(name: string, content: string, origin: 'foreground' | 'background_review'): Promise<SkillActionResult> {
    const normalized = name.trim()
    if (!SKILL_NAME_RE.test(normalized) || normalized.length > MAX_SKILL_NAME_LENGTH) {
      return { ok: false, message: `Invalid skill name "${normalized}". Use lowercase letters, digits, and hyphens (<= ${MAX_SKILL_NAME_LENGTH}).` }
    }
    const validation = validateFrontmatter(content, normalized)
    if (validation) return { ok: false, message: validation }
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
    const dir = skillDir(this.root, normalized)
    if (await exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${normalized}" already exists.` }
    await mkdir(dir, { recursive: true })
    await atomicWrite(join(dir, 'SKILL.md'), content.trimEnd() + '\n')
    if (origin === 'background_review') {
      await writeFile(markerPath(dir, 'hermes-managed'), '', 'utf8')
    }
    return { ok: true, message: `Skill "${normalized}" created.`, path: dir }
  }

  async update(name: string, content: string): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    const md = await readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateFrontmatter(content, name)
    if (validation) return { ok: false, message: validation }
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
    await atomicWrite(join(dir, 'SKILL.md'), content.trimEnd() + '\n')
    return { ok: true, message: `Skill "${name}" updated.`, path: dir }
  }

  async patch(name: string, oldString: string, newString: string, filePath = '', replaceAll = false): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    const skillMd = join(dir, 'SKILL.md')
    if (!await exists(skillMd)) return { ok: false, message: `Skill "${name}" not found.` }
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
    const md = await readText(target)
    if (!md) return { ok: false, message: `File not found: ${patchLabel}` }

    const patched = fuzzyPatch(md, oldString, newString, replaceAll)
    if (!patched) return { ok: false, message: `Could not find old_string in "${name}/${patchLabel}". Use update for a full rewrite.` }
    if (target === skillMd) {
      const validation = validateFrontmatter(patched, name)
      if (validation) return { ok: false, message: `Patch rejected: ${validation}` }
    }
    if (Buffer.byteLength(patched, 'utf8') > MAX_SKILL_FILE_BYTES && target !== skillMd) {
      return { ok: false, message: `Patched file exceeds ${MAX_SKILL_FILE_BYTES} bytes.` }
    }
    if (patched.length > MAX_SKILL_CONTENT_CHARS && target === skillMd) {
      return { ok: false, message: `Patched content exceeds ${MAX_SKILL_CONTENT_CHARS} characters.` }
    }
    const threat = scanContentThreats(patched)
    if (threat) return { ok: false, message: threat }
    await atomicWrite(target, patched.trimEnd() + '\n')
    return { ok: true, message: `Skill "${name}" patched (${patchLabel}).`, path: dir }
  }

  async archive(name: string, absorbedInto = ''): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    const md = await readText(join(dir, 'SKILL.md'))
    if (!md) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.deleteProtection(name)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    if (absorbedInto) {
      const target = await readText(join(skillDir(this.root, absorbedInto), 'SKILL.md'))
      if (!target) return { ok: false, message: `absorbed_into="${absorbedInto}" does not exist.` }
    }
    const archiveRoot = join(this.root, '.archive')
    await mkdir(archiveRoot, { recursive: true })
    let dest = join(archiveRoot, name)
    if (await exists(dest)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      dest = join(archiveRoot, `${name}-${stamp}`)
    }
    try {
      await rename(dir, dest)
    } catch {
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, 'SKILL.md'), md, 'utf8')
      await rm(dir, { recursive: true, force: true })
    }
    const reason = absorbedInto ? `Consolidated into ${absorbedInto}` : 'Archived by self-evolution curator'
    await writeFile(join(dest, '.archive-reason'), `${new Date().toISOString()}: ${reason}\n`, 'utf8')
    return { ok: true, message: `Skill "${name}" archived to .archive.`, path: dest }
  }

  async writeSupportFile(name: string, filePath: string, content: string): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    if (!await exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
    if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_FILE_BYTES) return { ok: false, message: `Support file exceeds ${MAX_SKILL_FILE_BYTES} bytes.` }
    const threat = scanContentThreats(content)
    if (threat) return { ok: false, message: threat }
      const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    await atomicWrite(target, content)
    return { ok: true, message: `Support file "${filePath}" written to "${name}".`, path: target }
  }

  async removeSupportFile(name: string, filePath: string): Promise<SkillActionResult> {
    const dir = skillDir(this.root, name)
    if (!await exists(join(dir, 'SKILL.md'))) return { ok: false, message: `Skill "${name}" not found.` }
    const protection = await this.writeProtection(name)
    if (protection) return { ok: false, message: `Skill "${name}" is protected (${protection}).` }
    const validation = validateSupportPath(filePath)
    if (validation) return { ok: false, message: validation }
      const target = join(dir, ...filePath.replace(/\\/g, '/').split('/').filter(Boolean))
    if (!await exists(target)) return { ok: false, message: `File "${filePath}" not found in skill "${name}".` }
    await rm(target)
    return { ok: true, message: `Support file "${filePath}" removed from "${name}".`, path: target }
  }


  async snapshotAll(reason = 'pre-mutation'): Promise<string> {
    const backupRoot = join(this.root, '.backups')
    await mkdir(backupRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(backupRoot, `skills-${stamp}`)
    await mkdir(dest, { recursive: true })
    const names = await listNames(this.root)
    for (const name of names) {
      await cp(skillDir(this.root, name), join(dest, name), { recursive: true })
    }
    await writeFile(join(dest, 'manifest.json'), JSON.stringify({ reason, createdAt: new Date().toISOString(), skills: names }, null, 2), 'utf8')
    return dest
  }

  async listSnapshots(): Promise<Array<{ path: string; createdAt: string; reason: string }>> {
    const backupRoot = join(this.root, '.backups')
    let entries: string[]
    try { entries = await readdir(backupRoot) } catch { return [] }
    const out: Array<{ path: string; createdAt: string; reason: string }> = []
    for (const name of entries.sort().reverse()) {
      if (!name.startsWith('skills-')) continue
      try {
        const manifest = JSON.parse(await readFile(join(backupRoot, name, 'manifest.json'), 'utf8')) as { createdAt?: string; reason?: string }
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
    for (const name of await listNames(this.root)) {
      await rm(skillDir(this.root, name), { recursive: true, force: true })
    }
    const entries = await readdir(latest.path)
    for (const entry of entries) {
      if (entry === 'manifest.json') continue
      await cp(join(latest.path, entry), join(this.root, entry), { recursive: true })
    }
    return { ok: true, message: `Restored skill tree from ${latest.path}`, path: latest.path }
  }
}
