import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { DiscoveryFence } from './domain-map-store.ts'

/** Frozen view identity captured when a session is created. */
export interface ViewSnapshot {
  readonly sessionId: string
  readonly viewKey: string
  readonly cwd: string
  readonly viewCatalogDigest: string
  readonly mapVersion: string
  readonly configDigest: string
  readonly featureEpoch: string
  readonly createdAt: number
}

interface SnapshotFile { readonly schemaVersion: 1; readonly sessions: Readonly<Record<string, Omit<ViewSnapshot, 'sessionId'>>> }

/** Durable per-session view snapshot; old epochs stay frozen. */
export class ViewSnapshotStore {
  private readonly io: EvolutionIoLike
  private readonly path: string
  private serial: Promise<void> = Promise.resolve()
  private readonly fence: DiscoveryFence | undefined

  constructor(io: EvolutionIoLike, path: string, fence?: DiscoveryFence) { this.io = io; this.path = path; this.fence = fence }

  private async fenced<T>(task: () => Promise<T>): Promise<T> {
    if (this.fence !== undefined) return await this.fence.run(task)
    return await task()
  }

  private async read(): Promise<SnapshotFile> {
    return this.decode(await this.io.readText(this.path))
  }

  /** Persist one session snapshot; first writer wins unless overwrite is explicit. */
  async put(snapshot: ViewSnapshot, options: { readonly overwrite?: boolean | undefined } = {}): Promise<void> {
    const apply = (raw: string | null): string | null => {
      const current = this.decode(raw)
      if (current.sessions[snapshot.sessionId] !== undefined && options.overwrite !== true) return raw
      const sessions = { ...current.sessions, [snapshot.sessionId]: { viewKey: snapshot.viewKey, cwd: snapshot.cwd, viewCatalogDigest: snapshot.viewCatalogDigest, mapVersion: snapshot.mapVersion, configDigest: snapshot.configDigest, featureEpoch: snapshot.featureEpoch, createdAt: snapshot.createdAt } }
      return JSON.stringify({ schemaVersion: 1, sessions })
    }
    if (this.io.transact !== undefined) {
      await this.fenced(async () => { await this.io.transact!(this.path, current => apply(current)) })
      return
    }
    const task = async (): Promise<void> => await this.fenced(async () => {
      const current = await this.io.readText(this.path)
      const next = apply(current)
      if (next !== null && next !== current) await this.io.writeText(this.path, next)
    })
    this.serial = this.serial.then(task, task)
    await this.serial
  }

  private decode(content: string | null): SnapshotFile {
    if (content === null) return { schemaVersion: 1, sessions: {} }
    try {
      const parsed = JSON.parse(content) as { schemaVersion?: unknown; sessions?: unknown }
      return parsed.schemaVersion === 1 && typeof parsed.sessions === 'object' && parsed.sessions !== null
        ? { schemaVersion: 1, sessions: parsed.sessions as SnapshotFile['sessions'] }
        : { schemaVersion: 1, sessions: {} }
    } catch { return { schemaVersion: 1, sessions: {} } }
  }

  /** @returns frozen snapshot for one session, if recorded. */
  async get(sessionId: string): Promise<ViewSnapshot | undefined> {
    const entry = (await this.read()).sessions[sessionId]
    return entry === undefined ? undefined : { sessionId, ...entry }
  }

  /**
   * @returns true for legacy sessions without a snapshot and for older feature epochs.
   */
  async isFrozen(sessionId: string, currentFeatureEpoch: string): Promise<boolean> {
    const snapshot = await this.get(sessionId)
    return snapshot === undefined || snapshot.featureEpoch !== currentFeatureEpoch
  }
}
