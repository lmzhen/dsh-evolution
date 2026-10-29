import { contentHash } from './mutations.ts'
import type { SkillSummary } from './skill-store.ts'

export interface SkillListQuery {
  withContent?: boolean
  withFrontmatter?: boolean
  withSupport?: boolean
}

export interface SkillSupportFile {
  path: string
  bytes: number
  sha256: string
}

export interface SkillDocumentHashes {
  threeField: string
  content: string
  support: string
}

export interface SkillDocument {
  summary: SkillSummary
  content: string
  frontmatter: Record<string, unknown>
  support: SkillSupportFile[]
  hashes: SkillDocumentHashes
  readable: boolean
}

export interface SkillModelProvider {
  list(query?: SkillListQuery): Promise<SkillSummary[]>
  read(name: string): Promise<string | null>
  listSupportFiles(name: string): Promise<readonly string[]>
  readSupportFile(name: string, path: string): Promise<string | null>
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const record = value as Record<string, unknown>
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}'
}

function threeFieldHash(summary: SkillSummary): string {
  return contentHash(canonical([
    summary.name,
    summary.description,
    summary.whenToUse ?? '',
  ]))
}

function supportHash(files: readonly SkillSupportFile[]): string {
  return contentHash(canonical(files.map(file => [file.path, file.sha256, file.bytes])))
}

/**
 * Canonical read face for skill consumers.
 *
 * This is an adapter, not a second store: the provider owns IO and summary
 * extraction. Every consumer reads the same SkillDocument contract so owner,
 * health, panel and future domain/search surfaces cannot drift on parsing,
 * whenToUse or support hashing.
 */
export class SkillModel {
  constructor(private readonly provider: SkillModelProvider) {}

  async list(query: SkillListQuery = {}): Promise<SkillSummary[]> {
    return await this.provider.list(query)
  }

  async get(name: string): Promise<SkillDocument | null> {
    const summaries = await this.provider.list({ withFrontmatter: true })
    const summary = summaries.find(candidate => candidate.name === name)
    if (summary === undefined) return null
    let content: string | null = null
    let readable = true
    try {
      content = await this.provider.read(name)
    } catch {
      readable = false
    }
    if (content === null) readable = false
    const paths = readable ? await this.provider.listSupportFiles(name) : []
    const support: SkillSupportFile[] = []
    for (const path of paths) {
      const file = await this.provider.readSupportFile(name, path)
      if (file === null) continue
      support.push({ path, bytes: Buffer.byteLength(file, 'utf8'), sha256: contentHash(file) })
    }
    support.sort((a, b) => a.path.localeCompare(b.path))
    return {
      summary,
      content: content ?? '',
      frontmatter: summary.frontmatter ?? {},
      support,
      hashes: {
        threeField: threeFieldHash(summary),
        content: contentHash(content ?? ''),
        support: supportHash(support),
      },
      readable,
    }
  }
}
