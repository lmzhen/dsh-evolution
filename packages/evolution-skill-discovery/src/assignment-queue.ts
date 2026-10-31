import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { AssignmentQueue, AssignmentQueueEntry, AssignmentSubmission } from './assignment.ts'

interface QueueFile { readonly schemaVersion: 1; readonly entries: readonly AssignmentQueueEntry[] }

/** Durable assignment queue; process-local cache over one JSON file. */
export class JsonAssignmentQueue implements AssignmentQueue {
  private readonly entries = new Map<string, AssignmentQueueEntry>()
  private loaded = false
  private readonly io: EvolutionIoLike
  private readonly path: string
  constructor(io: EvolutionIoLike, path: string) { this.io = io; this.path = path }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const content = await this.io.readText(this.path)
    if (content === null) return
    try {
      const parsed = JSON.parse(content) as QueueFile
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) return
      for (const entry of parsed.entries) this.entries.set(entry.key, entry)
    } catch { /* corrupt queue rebuilt from later submissions */ }
  }

  private async persist(): Promise<void> { await this.io.writeText(this.path, JSON.stringify({ schemaVersion: 1, entries: [...this.entries.values()] })) }

  async enqueue(input: { key: string; submission: AssignmentSubmission; proposalDigest: string; createdAt: number }): Promise<{ entry: AssignmentQueueEntry; duplicate: boolean }> {
    await this.load()
    const existing = this.entries.get(input.key)
    if (existing !== undefined) return { entry: existing, duplicate: true }
    const entry: AssignmentQueueEntry = { ...input, status: 'queued' }
    this.entries.set(input.key, entry)
    await this.persist()
    return { entry, duplicate: false }
  }

  async update(key: string, status: AssignmentQueueEntry['status'], pendingReason?: AssignmentQueueEntry['pendingReason']): Promise<void> {
    await this.load()
    const entry = this.entries.get(key)
    if (entry === undefined) return
    entry.status = status
    entry.pendingReason = pendingReason
    await this.persist()
  }

  list(): readonly AssignmentQueueEntry[] { return [...this.entries.values()] }
}
