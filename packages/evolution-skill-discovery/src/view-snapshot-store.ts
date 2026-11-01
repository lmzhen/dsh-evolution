import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

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

  constructor(io: EvolutionIoLike, path: string) { this.io = io; this.path = path }

  private async read(): Promise<SnapshotFile> {
    const content = await this.io.readText(this.path)
    if (content === null) return { schemaVersion: 1, sessions: {} }
    try {
      const parsed = JSON.parse(content) as { schemaVersion?: unknown; sessions?: unknown }
      return parsed.schemaVersion === 1 && typeof parsed.sessions === 'object' && parsed.sessions !== null
        ? { schemaVersion: 1, sessions: parsed.sessions as SnapshotFile['sessions'] }
        : { schemaVersion: 1, sessions: {} }
    } catch { return { schemaVersion: 1, sessions: {} } }
  }

  /** Persist one session snapshot; first writer wins unless overwrite is explicit. */
  async put(snapshot: ViewSnapshot, options: { readonly overwrite?: boolean | undefined } = {}): Promise<void> {
    const current = await this.read()
    if (current.sessions[snapshot.sessionId] !== undefined && options.overwrite !== true) return
    const sessions = { ...current.sessions, [snapshot.sessionId]: { viewKey: snapshot.viewKey, cwd: snapshot.cwd, viewCatalogDigest: snapshot.viewCatalogDigest, mapVersion: snapshot.mapVersion, configDigest: snapshot.configDigest, featureEpoch: snapshot.featureEpoch, createdAt: snapshot.createdAt } }
    await this.io.writeText(this.path, JSON.stringify({ schemaVersion: 1, sessions }))
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
