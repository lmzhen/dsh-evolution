import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { shouldHideCatalog, type DiscoverySessionMeta } from './session-projection.ts'

/** One persisted session's discovery mode. */
export interface DiscoverySessionRecord {
  readonly sessionId: string
  readonly discoveryMode: 'off' | 'shadow' | 'on'
  readonly featureEpoch: string
  readonly projectionDigest?: string | undefined
}

interface SessionFile { readonly schemaVersion: 1; readonly sessions: Readonly<Record<string, Omit<DiscoverySessionRecord, 'sessionId'>>> }

/** Plugin-side session metadata; platform SessionHeader has no discovery fields. */
export class DiscoverySessionStore {
  private readonly io: EvolutionIoLike
  private readonly path: string
  constructor(io: EvolutionIoLike, path: string) { this.io = io; this.path = path }

  private async read(): Promise<SessionFile> {
    const content = await this.io.readText(this.path)
    if (content === null) return { schemaVersion: 1, sessions: {} }
    try {
      const parsed = JSON.parse(content) as { schemaVersion?: unknown; sessions?: unknown }
      return parsed.schemaVersion === 1 && typeof parsed.sessions === 'object' && parsed.sessions !== null
        ? { schemaVersion: 1, sessions: parsed.sessions as SessionFile['sessions'] }
        : { schemaVersion: 1, sessions: {} }
    } catch { return { schemaVersion: 1, sessions: {} } }
  }

  /** @returns persisted metadata for one session. */
  async get(sessionId: string): Promise<DiscoverySessionRecord | undefined> {
    const entry = (await this.read()).sessions[sessionId]
    return entry === undefined ? undefined : { sessionId, ...entry }
  }

  /** Persist one session's mode/epoch; later writes win. */
  async put(record: DiscoverySessionRecord): Promise<void> {
    const current = await this.read()
    const previous = current.sessions[record.sessionId]
    const projectionDigest = record.projectionDigest ?? previous?.projectionDigest
    const sessions = { ...current.sessions, [record.sessionId]: { discoveryMode: record.discoveryMode, featureEpoch: record.featureEpoch, ...projectionDigest === undefined ? {} : { projectionDigest } } }
    await this.io.writeText(this.path, JSON.stringify({ schemaVersion: 1, sessions }))
  }
}

/** @returns true only for a persisted enabled session in the current feature epoch. */
export async function shouldProjectPersistedSession(store: DiscoverySessionStore, sessionId: string, currentFeatureEpoch: string): Promise<boolean> {
  const meta: DiscoverySessionMeta | undefined = await store.get(sessionId)
  return shouldHideCatalog(meta, currentFeatureEpoch)
}
