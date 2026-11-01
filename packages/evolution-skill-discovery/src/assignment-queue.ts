import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionCollection, EvolutionStateStore } from '@deepseek-ai/dsh-evolution-contract'
import type { AssignmentQueue, AssignmentQueueEntry, AssignmentSubmission } from './assignment.ts'

const COLLECTION = 'assignment-queue' as EvolutionCollection

interface QueueFile { readonly schemaVersion: 1; readonly entries: readonly AssignmentQueueEntry[] }

/** Durable assignment queue; process-local cache over one JSON file. */
export class JsonAssignmentQueue implements AssignmentQueue {
  private readonly entries = new Map<string, AssignmentQueueEntry>()
  private loadPromise: Promise<void> | undefined
  private readonly io: EvolutionIoLike
  private readonly path: string
  private readonly store: EvolutionStateStore | undefined
  constructor(io: EvolutionIoLike, path: string, store?: EvolutionStateStore) { this.io = io; this.path = path; this.store = store }

  load(): Promise<void> {
    this.loadPromise ??= (async () => {
      if (this.store !== undefined) {
        for (const entry of await this.store.list<AssignmentQueueEntry>(COLLECTION)) this.entries.set(entry.key, entry)
        if (this.entries.size > 0) return
      }
      const content = await this.io.readText(this.path)
      if (content === null) return
      try {
        const parsed = JSON.parse(content) as QueueFile
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) return
        for (const entry of parsed.entries) {
          this.entries.set(entry.key, entry)
          if (this.store !== undefined) await this.store.transact(COLLECTION, entry.key, async () => entry)
        }
      } catch { /* corrupt queue rebuilt from later submissions */ }
    })()
    return this.loadPromise
  }

  private async persist(): Promise<void> { if (this.store === undefined) await this.io.writeText(this.path, JSON.stringify({ schemaVersion: 1, entries: [...this.entries.values()] })) }

  async enqueue(input: { key: string; submission: AssignmentSubmission; proposalDigest: string; createdAt: number }): Promise<{ entry: AssignmentQueueEntry; duplicate: boolean }> {
    await this.load()
    const existing = this.entries.get(input.key)
    if (existing !== undefined) return { entry: existing, duplicate: true }
    const entry: AssignmentQueueEntry = { ...input, status: 'queued' }
    if (this.store !== undefined) {
      let duplicate = false
      let stored = entry
      await this.store.transact<AssignmentQueueEntry>(COLLECTION, input.key, async current => {
        if (current !== undefined) { duplicate = true; stored = current; return current }
        return entry
      })
      this.entries.set(input.key, stored)
      return { entry: stored, duplicate }
    }
    this.entries.set(input.key, entry)
    await this.persist()
    return { entry, duplicate: false }
  }

  async update(key: string, status: AssignmentQueueEntry['status'], pendingReason?: AssignmentQueueEntry['pendingReason']): Promise<void> {
    await this.load()
    const entry = this.entries.get(key)
    if (entry === undefined) return
    const nextEntry: AssignmentQueueEntry = { ...entry, status, pendingReason }
    if (this.store !== undefined) {
      await this.store.transact<AssignmentQueueEntry>(COLLECTION, key, async current => current === undefined ? nextEntry : { ...current, status, pendingReason })
    }
    this.entries.set(key, nextEntry)
    await this.persist()
  }

  list(): readonly AssignmentQueueEntry[] { return [...this.entries.values()] }
}
