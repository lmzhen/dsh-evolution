import { isRecord, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { DomainMapSnapshot, DomainMapStore, DomainMapWrite, DomainNode, SkillDomainEdge } from './domain-map.ts'

/** File schema version supported by this store. */
export const DOMAIN_MAP_SCHEMA_VERSION = 1

/** The file on disk; updatedAt is storage metadata, not a domain fact. */
interface DomainMapFile {
  readonly schemaVersion: 1
  readonly mapVersion: string
  readonly updatedAt: number
  readonly domains: readonly DomainNode[]
  readonly edges: readonly SkillDomainEdge[]
}

/** Typed failure for an invalid persisted file. */
export class DomainMapCorruptError extends Error {
  readonly code = 'domain-map-corrupt'
  constructor(message: string) { super(message); this.name = 'DomainMapCorruptError' }
}

/** Typed failure for a CAS mismatch. */
export class DomainMapVersionConflict extends Error {
  readonly code = 'domain-map-version-conflict'
  readonly expected: string
  readonly actual: string
  constructor(expected: string, actual: string) {
    super('domain map version conflict: expected ' + expected + ', found ' + actual)
    this.expected = expected
    this.actual = actual
    this.name = 'DomainMapVersionConflict'
  }
}

/** Typed failure for an invalid write. */
export class DomainMapValidationError extends Error {
  readonly code = 'domain-map-invalid'
  constructor(message: string) { super(message); this.name = 'DomainMapValidationError' }
}

function emptySnapshot(): DomainMapSnapshot {
  return { mapVersion: '0', domains: [], edges: [] }
}

function assertNode(node: unknown): asserts node is DomainNode {
  if (!isRecord(node) || typeof node.id !== 'string' || node.id.length === 0) throw new DomainMapCorruptError('domain node id is missing')
  if (typeof node.name !== 'string' || typeof node.purpose !== 'string' || typeof node.description !== 'string') throw new DomainMapCorruptError('domain node text fields are missing')
  if (!Array.isArray(node.inScope) || !Array.isArray(node.outOfScope) || !Array.isArray(node.triggers) || !Array.isArray(node.parentIds)) throw new DomainMapCorruptError('domain node arrays are invalid')
  if (node.status !== 'active' && node.status !== 'provisional' && node.status !== 'deprecated') throw new DomainMapCorruptError('domain node status is invalid')
}

function assertEdge(edge: unknown): asserts edge is SkillDomainEdge {
  if (!isRecord(edge) || typeof edge.skillKey !== 'string' || typeof edge.domainId !== 'string') throw new DomainMapCorruptError('skill edge identity is missing')
  if (edge.role !== 'primary' && edge.role !== 'secondary') throw new DomainMapCorruptError('skill edge role is invalid')
  if (edge.status !== 'active' && edge.status !== 'stale' && edge.status !== 'pending') throw new DomainMapCorruptError('skill edge status is invalid')
  if (typeof edge.confidence !== 'number' || edge.confidence < 0 || edge.confidence > 1) throw new DomainMapCorruptError('skill edge confidence is invalid')
}

function validateWrite(next: DomainMapWrite): void {
  if (next.mapVersion.length === 0) throw new DomainMapValidationError('mapVersion must be non-empty')
  const ids = new Set<string>()
  for (const node of next.domains) {
    assertNode(node)
    if (ids.has(node.id)) throw new DomainMapValidationError('duplicate domain id ' + node.id)
    ids.add(node.id)
  }
  for (const node of next.domains) {
    for (const parent of node.parentIds) {
      if (parent === node.id) throw new DomainMapValidationError('domain self-parent ' + node.id)
      if (!ids.has(parent)) throw new DomainMapValidationError('unknown parent domain ' + parent)
    }
  }
  const edgeKeys = new Set<string>()
  const primaries = new Map<string, number>()
  for (const edge of next.edges) {
    assertEdge(edge)
    if (!ids.has(edge.domainId)) throw new DomainMapValidationError('unknown edge domain ' + edge.domainId)
    const key = edge.skillKey + '\u0000' + edge.domainId
    if (edgeKeys.has(key)) throw new DomainMapValidationError('duplicate skill/domain edge')
    edgeKeys.add(key)
    if (edge.role === 'primary') {
      const count = (primaries.get(edge.skillKey) ?? 0) + 1
      if (count > 1) throw new DomainMapValidationError('more than one primary domain for ' + edge.skillKey)
      primaries.set(edge.skillKey, count)
    }
  }
}

/**
 * JSON-backed DomainMap owner. One file, schemaVersion, CAS mapVersion, and a
 * best-effort .bak for rollback; no evolution-state tables or graph DB.
 */
export class DomainMapFileStore implements DomainMapStore {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly io: EvolutionIoLike
  private readonly path: string
  private readonly now: () => number
  constructor(io: EvolutionIoLike, path: string, now: () => number = Date.now) {
    this.io = io
    this.path = path
    this.now = now
  }

  private get backupPath(): string { return this.path + '.bak' }

  private parse(content: string | null): DomainMapSnapshot {
    if (content === null) return emptySnapshot()
    let value: unknown
    try { value = JSON.parse(content) } catch { throw new DomainMapCorruptError('domain map is not valid JSON') }
    if (!isRecord(value) || value.schemaVersion !== DOMAIN_MAP_SCHEMA_VERSION || typeof value.mapVersion !== 'string' || !Array.isArray(value.domains) || !Array.isArray(value.edges)) {
      throw new DomainMapCorruptError('domain map schema is unsupported')
    }
    for (const node of value.domains) assertNode(node)
    for (const edge of value.edges) assertEdge(edge)
    return { mapVersion: value.mapVersion, domains: value.domains, edges: value.edges }
  }

  async read(): Promise<DomainMapSnapshot> {
    return this.parse(await this.io.readText(this.path))
  }

  private async commitNow(current: string | null, expected: string, next: DomainMapWrite): Promise<string> {
    const snapshot = this.parse(current)
    if (snapshot.mapVersion !== expected) throw new DomainMapVersionConflict(expected, snapshot.mapVersion)
    if (next.mapVersion === expected) throw new DomainMapValidationError('mapVersion must change on commit')
    validateWrite(next)
    if (current !== null) await this.io.writeText(this.backupPath, current)
    const file: DomainMapFile = { schemaVersion: DOMAIN_MAP_SCHEMA_VERSION, mapVersion: next.mapVersion, updatedAt: this.now(), domains: next.domains, edges: next.edges }
    return JSON.stringify(file)
  }

  async commit(expectedMapVersion: string, next: DomainMapWrite): Promise<DomainMapSnapshot> {
    const run = async (): Promise<void> => {
      if (this.io.transact !== undefined) {
        await this.io.transact(this.path, current => this.commitNow(current, expectedMapVersion, next))
      } else {
        const current = await this.io.readText(this.path)
        await this.io.writeText(this.path, await this.commitNow(current, expectedMapVersion, next))
      }
    }
    const pending = this.queue.then(run, run)
    this.queue = pending.catch(() => {})
    await pending
    return this.read()
  }

  async rollback(): Promise<DomainMapSnapshot> {
    const backup = await this.io.readText(this.backupPath)
    if (backup === null) throw new DomainMapCorruptError('domain map backup is missing')
    const snapshot = this.parse(backup)
    await this.io.writeText(this.path, backup)
    return snapshot
  }
}
