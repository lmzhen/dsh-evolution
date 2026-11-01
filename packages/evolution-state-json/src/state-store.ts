/**
 * Generic JSON-file implementation of the contract StateStore.
 *
 * One file per collection; records use a key map. `transact` delegates to the
 * IO seam's transact, so the medium's serialization/CAS behavior is preserved.
 * The node backend is process-local, so capabilities.crossProcess is false.
 */
import type { EvolutionCollection, EvolutionStateCapabilities, EvolutionStateStore } from '@deepseek-ai/dsh-evolution-contract'
import { makeSerialQueue, transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'

interface CollectionFile { readonly schemaVersion: 1; readonly records: Record<string, unknown> }

const safeName = (collection: EvolutionCollection): string => String(collection).replace(/[^a-zA-Z0-9._-]/g, '_')

export class JsonStateStore implements EvolutionStateStore {
  readonly name = 'json-state-store'
  readonly capabilities: EvolutionStateCapabilities = { crossProcess: false }
  private readonly io: EvolutionIoLike
  private readonly root: string
  private readonly serial = makeSerialQueue()
  constructor(io: EvolutionIoLike, root: string) { this.io = io; this.root = root }

  private path(collection: EvolutionCollection): string { return join(this.root, 'state-store', safeName(collection) + '.json') }

  private async load(collection: EvolutionCollection): Promise<CollectionFile> {
    const text = await this.io.readText(this.path(collection))
    if (text === null) return { schemaVersion: 1, records: {} }
    const parsed = JSON.parse(text) as CollectionFile
    if (parsed.schemaVersion !== 1 || parsed.records === null || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) {
      throw new Error('state-store collection is corrupt: ' + String(collection))
    }
    return parsed
  }

  async read<T>(collection: EvolutionCollection, key: string): Promise<T | undefined> {
    return (await this.load(collection)).records[key] as T | undefined
  }

  async transact<T>(collection: EvolutionCollection, key: string, fn: (current: T | undefined) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      let next!: T
      await transactIo(this.io, this.path(collection), async (current) => {
        const file: CollectionFile = current === null ? { schemaVersion: 1, records: {} } : JSON.parse(current) as CollectionFile
        next = await fn(file.records[key] as T | undefined)
        file.records[key] = next
        return JSON.stringify(file)
      })
      return next
    })
  }

  async list<T>(collection: EvolutionCollection): Promise<T[]> {
    return Object.values((await this.load(collection)).records) as T[]
  }
}
