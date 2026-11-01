import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { CatalogCapture } from './catalog-codec.ts'

/** Durable record of one projection so it can be restored after restart. */
export interface ProjectionJournalRecord {
  readonly sessionId: string
  readonly viewKey: string
  readonly projectionDigest: string
  readonly codecVersion: string
  readonly mapVersion: string
  readonly policyDigest: string
  readonly base: CatalogCapture
  readonly createdAt: number
}

interface JournalFile {
  readonly schemaVersion: 1
  readonly records: Readonly<Record<string, ProjectionJournalRecord>>
}

function keyOf(record: Pick<ProjectionJournalRecord, 'sessionId' | 'viewKey' | 'projectionDigest' | 'codecVersion'>): string {
  return record.sessionId + '|' + record.viewKey + '|' + record.projectionDigest + '|' + record.codecVersion
}

/** Durable projection journal; no base means restore must fail closed. */
export class ProjectionJournal {
  private readonly io: EvolutionIoLike
  private readonly path: string
  private readonly maxRecords: number

  constructor(io: EvolutionIoLike, path: string, options: { readonly maxRecords?: number | undefined } = {}) {
    this.io = io
    this.path = path
    this.maxRecords = options.maxRecords ?? 512
  }

  private async read(): Promise<JournalFile> {
    const content = await this.io.readText(this.path)
    if (content === null) return { schemaVersion: 1, records: {} }
    try {
      const parsed = JSON.parse(content) as { schemaVersion?: unknown; records?: unknown }
      return parsed.schemaVersion === 1 && typeof parsed.records === 'object' && parsed.records !== null
        ? { schemaVersion: 1, records: parsed.records as JournalFile['records'] }
        : { schemaVersion: 1, records: {} }
    } catch { return { schemaVersion: 1, records: {} } }
  }

  /** Persist one projection record; later records with the same key win. */
  async put(record: ProjectionJournalRecord): Promise<void> {
    const current = await this.read()
    const records = { ...current.records, [keyOf(record)]: record }
    const ordered = Object.entries(records).sort((left, right) => right[1].createdAt - left[1].createdAt).slice(0, this.maxRecords)
    await this.io.writeText(this.path, JSON.stringify({ schemaVersion: 1, records: Object.fromEntries(ordered) }))
  }

  /** @returns the exact projection record for one view/digest/codec, if present. */
  async get(sessionId: string, viewKey: string, projectionDigest: string, codecVersion: string): Promise<ProjectionJournalRecord | undefined> {
    return (await this.read()).records[keyOf({ sessionId, viewKey, projectionDigest, codecVersion })]
  }

  /** @returns newest record for a view, used when leaving ready without a known digest. */
  async latest(sessionId: string, viewKey: string, codecVersion: string): Promise<ProjectionJournalRecord | undefined> {
    const matches = Object.values((await this.read()).records)
      .filter(record => record.sessionId === sessionId && record.viewKey === viewKey && record.codecVersion === codecVersion)
      .sort((left, right) => right.createdAt - left.createdAt)
    return matches[0]
  }

  /** Delete one record after a successful restore. */
  async remove(sessionId: string, viewKey: string, projectionDigest: string, codecVersion: string): Promise<void> {
    const current = await this.read()
    const records = { ...current.records }
    delete records[keyOf({ sessionId, viewKey, projectionDigest, codecVersion })]
    await this.io.writeText(this.path, JSON.stringify({ schemaVersion: 1, records }))
  }
}
