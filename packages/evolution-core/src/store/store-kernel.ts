/**
 * Home MVCC store kernel.
 *
 * Writers serialize on the family's one HomeFence, publish immutable content
 * objects, then atomically replace `head.json`. Readers resolve one head and
 * one commit; they never take a writer lock, so a long writer cannot block a
 * read and a read can never observe a half-published commit.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/store-kernel
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isRecord } from '../guards.ts'
import type { EvolutionIoLike } from '../io.ts'
import {
  STORE_COMMIT_SOURCES,
  STORE_DOMAIN_IDS,
  StoreConflictError,
  StoreCorruptError,
  StoreError,
  StoreImmutableConflictError,
  StoreNotInitializedError,
  type StoreCommit,
  type StoreCommitResult,
  type StoreCommitSource,
  type StoreDomainId,
  type StoreDomainValues,
  type StoreGarbageCollectionResult,
  type StoreHead,
  type StoreKernelOptions,
  type StoreMutation,
  type StoreSnapshot,
  type StoreTreeRef,
} from './types.ts'

const SCHEMA_VERSION = 1
const HEAD_FILE = 'head.json'
const COMMITS_DIR = 'commits'
const OBJECTS_DIR = 'objects'

const DOMAIN_IDS: ReadonlySet<string> = new Set(STORE_DOMAIN_IDS)

const isDomainId = (value: string): value is StoreDomainId => DOMAIN_IDS.has(value)

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** JSON with recursively sorted object keys, so equal values always hash equal. */
function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new StoreError('store-invalid-value', 'store values must be finite JSON numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(item => item === undefined ? 'null' : stableStringify(item)).join(',') + ']'
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new StoreError('store-invalid-value', 'store values must be plain JSON objects; class instances and maps are not supported')
    }
    const entries: string[] = []
    for (const key of Object.keys(value).sort()) {
      const entry = value[key]
      if (entry === undefined) continue
      entries.push(JSON.stringify(key) + ':' + stableStringify(entry))
    }
    return '{' + entries.join(',') + '}'
  }
  throw new StoreError('store-invalid-value', 'store values must be JSON-serializable')
}

/** Deep-freeze a parsed snapshot before handing it to a mutator. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value) as T
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new StoreCorruptError(`${where}: "${key}" must be a non-empty string`)
  return value
}

function parseHead(text: string, path: string): StoreHead {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new StoreCorruptError(`${path}: head is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(raw)) throw new StoreCorruptError(`${path}: head must be an object`)
  if (raw.schemaVersion !== SCHEMA_VERSION) throw new StoreCorruptError(`${path}: unsupported head schemaVersion ${String(raw.schemaVersion)}`)
  const commitId = requireString(raw, 'commitId', path)
  const commitSha256 = requireString(raw, 'commitSha256', path)
  const updatedAt = requireString(raw, 'updatedAt', path)
  if (!/^[0-9a-f]{64}$/.test(commitId)) throw new StoreCorruptError(`${path}: commitId is not a sha256`)
  if (!/^[0-9a-f]{64}$/.test(commitSha256)) throw new StoreCorruptError(`${path}: commitSha256 is not a sha256`)
  if (Number.isNaN(Date.parse(updatedAt))) throw new StoreCorruptError(`${path}: updatedAt is not a date`)
  return { schemaVersion: SCHEMA_VERSION, commitId, commitSha256, updatedAt }
}

function parseTree(value: unknown, where: string): StoreTreeRef | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new StoreCorruptError(`${where}: tree must be an object or null`)
  const unitId = requireString(value, 'unitId', where + '.tree')
  const manifest = value.manifest
  if (manifest !== undefined && (typeof manifest !== 'string' || !/^[0-9a-f]{64}$/.test(manifest))) {
    throw new StoreCorruptError(`${where}.tree: manifest must be a sha256 when present`)
  }
  return manifest === undefined ? { unitId } : { unitId, manifest }
}

function parseDomains(value: unknown, where: string): Partial<Record<StoreDomainId, string>> {
  if (!isRecord(value)) throw new StoreCorruptError(`${where}: domains must be an object`)
  const domains: Partial<Record<StoreDomainId, string>> = {}
  for (const [key, hash] of Object.entries(value)) {
    if (!isDomainId(key)) throw new StoreCorruptError(`${where}: unknown domain "${key}"`)
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new StoreCorruptError(`${where}.${key}: object id must be a sha256`)
    domains[key] = hash
  }
  return domains
}

function parseCommit(text: string, path: string): StoreCommit {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new StoreCorruptError(`${path}: commit is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(raw)) throw new StoreCorruptError(`${path}: commit must be an object`)
  if (raw.schemaVersion !== SCHEMA_VERSION) throw new StoreCorruptError(`${path}: unsupported commit schemaVersion ${String(raw.schemaVersion)}`)
  const commitId = requireString(raw, 'commitId', path)
  if (!/^[0-9a-f]{64}$/.test(commitId)) throw new StoreCorruptError(`${path}: commitId is not a sha256`)
  const parent = raw.parent
  if (parent !== null && (typeof parent !== 'string' || !/^[0-9a-f]{64}$/.test(parent))) {
    throw new StoreCorruptError(`${path}: parent must be a sha256 or null`)
  }
  const createdAt = requireString(raw, 'createdAt', path)
  if (Number.isNaN(Date.parse(createdAt))) throw new StoreCorruptError(`${path}: createdAt is not a date`)
  const source = requireString(raw, 'source', path)
  if (!(STORE_COMMIT_SOURCES as readonly string[]).includes(source)) {
    throw new StoreCorruptError(`${path}: unknown source "${source}"`)
  }
  const commit: StoreCommit = {
    schemaVersion: SCHEMA_VERSION,
    commitId,
    parent,
    createdAt,
    domains: parseDomains(raw.domains, path),
    tree: parseTree(raw.tree, path),
    source: source as StoreCommitSource,
  }
  if (sha256(stableStringify(commitPayload(commit))) !== commit.commitId) {
    throw new StoreCorruptError(`${path}: commitId does not match the commit payload`)
  }
  return commit
}

/** The payload a commit id hashes; `commitId` itself is excluded. */
function commitPayload(commit: StoreCommit): Record<string, unknown> {
  return {
    schemaVersion: commit.schemaVersion,
    parent: commit.parent,
    createdAt: commit.createdAt,
    domains: commit.domains,
    tree: commit.tree,
    source: commit.source,
  }
}

/** The one read/write kernel. One instance per evolution home; all methods are stateless. */
export class StoreKernel {
  private readonly io: EvolutionIoLike
  private readonly fence: StoreKernelOptions['fence']
  private readonly root: string
  private readonly now: () => number
  /** Commits between bounded GC passes; 0 disables the in-write pass. */
  private readonly gcEveryWrites: number
  private writesSinceGc = 0

  constructor(options: StoreKernelOptions) {
    this.io = options.io
    this.fence = options.fence
    this.root = options.storeDir ?? join(options.home, 'store-v2')
    this.now = options.now ?? Date.now
    this.gcEveryWrites = Number.isInteger(options.gcEveryWrites) && (options.gcEveryWrites ?? 0) >= 0 ? (options.gcEveryWrites ?? 256) : 256
  }

  /** Read one consistent commit. This method never acquires the writer fence. */
  async query(domains: readonly StoreDomainId[] = STORE_DOMAIN_IDS): Promise<StoreSnapshot> {
    for (const domain of domains) {
      if (!isDomainId(domain)) throw new StoreError('store-invalid-domain', `unknown store domain "${String(domain)}"`)
    }
    let head = await this.readHeadForQuery()
    if (head === null) {
      const commits = await this.io.list(join(this.root, COMMITS_DIR))
      if (commits.length === 0) throw new StoreNotInitializedError(this.root)
      throw new StoreCorruptError(`${this.root}: commits exist but head.json is missing`)
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const commit = await this.readCommit(head)
        return await this.resolveDomains(commit, domains)
      } catch (error) {
        if (!(error instanceof StoreCorruptError)) throw error
        // A concurrent commit may have moved the head while this reader was
        // resolving an older one. Retry only when the head actually advanced;
        // a corrupt CURRENT head/object still fails closed.
        const next = await this.readHead()
        if (next === null || next.commitId === head.commitId) throw error
        head = next
      }
    }
    throw new StoreCorruptError(`${this.root}: could not resolve a stable commit after 3 attempts`)
  }

  /**
   * Publish one commit. The whole read-render-objects-head cycle runs inside
   * the one HomeFence; a nested caller (UnitKernel inside a tree write) reuses
   * the held fence instead of taking a second lock.
   */
  async mutate(request: StoreMutation): Promise<StoreCommitResult> {
    for (const domain of request.domains) {
      if (!isDomainId(domain)) throw new StoreError('store-invalid-domain', `unknown store domain "${String(domain)}"`)
    }
    return await this.fence.run(async () => {
      const head = await this.readHead()
      if (head === null) throw new StoreNotInitializedError(this.root)
      if (request.expectedHead !== undefined && request.expectedHead !== head.commitId) {
        throw new StoreConflictError(request.expectedHead, head.commitId)
      }
      const previous = await this.readCommit(head)
      // A tree-only commit (skill manifest) must not read every domain's blob
      // just to publish an empty domain set; the tree ref is the whole change.
      const current = request.domains.length === 0
        ? { commitId: previous.commitId, domains: {}, tree: previous.tree }
        : await this.resolveDomains(previous, Object.keys(previous.domains) as StoreDomainId[])
      const changed = await request.change(deepFreeze(current))
      // `change` may be async and HomeFence permits a nested commit (runNested).
      // If anything advanced the head while the mutator ran, this commit would
      // silently clobber it; refuse instead of overwriting.
      const after = await this.readHead()
      if (after === null) throw new StoreCorruptError(`${this.root}: head disappeared during mutation`)
      if (after.commitId !== head.commitId) throw new StoreConflictError(head.commitId, after.commitId)
      for (const domain of Object.keys(changed)) {
        if (!isDomainId(domain)) throw new StoreError('store-invalid-domain', `mutator returned unknown domain "${domain}"`)
        if (!request.domains.includes(domain)) {
          throw new StoreError('store-invalid-domain', `mutator changed unrequested domain "${domain}"`)
        }
      }
      const domains = { ...previous.domains }
      const values: StoreDomainValues = { ...current.domains }
      let changedAny = false
      for (const domain of Object.keys(changed) as StoreDomainId[]) {
        const value = changed[domain]
        if (value === undefined) continue
        const objectId = await this.writeObject(value)
        if (domains[domain] !== objectId) changedAny = true
        domains[domain] = objectId
        values[domain] = value
      }
      const tree = request.tree === undefined ? previous.tree : request.tree
      if (!changedAny && sameTree(previous.tree, tree)) {
        return { commitId: previous.commitId, domains: current.domains, tree: previous.tree }
      }
      const commit = this.buildCommit(previous.commitId, domains, tree, request.source)
      await this.writeCommit(commit)
      await this.writeHead(commit)
      this.writesSinceGc += 1
      if (this.gcEveryWrites > 0 && this.writesSinceGc >= this.gcEveryWrites) {
        this.writesSinceGc = 0
        // Bounded production GC: keep the 64-commit chain without requiring an
        // external maintenance caller. Nested fence.run reuses this critical
        // section, and collectGarbage reports deletion failures instead of throwing.
        await this.collectGarbage()
      }
      return { commitId: commit.commitId, domains: values, tree: commit.tree }
    })
  }

  /** Publish the first commit. Fails loud when a head already exists. */
  async bootstrap(values: StoreDomainValues, source: StoreCommitSource = 'bootstrap'): Promise<StoreCommitResult> {
    for (const domain of Object.keys(values)) {
      if (!isDomainId(domain)) throw new StoreError('store-invalid-domain', `unknown store domain "${domain}"`)
    }
    return await this.fence.run(async () => {
      if (await this.readHead() !== null) throw new StoreError('store-already-initialized', `home MVCC store already has a head at ${this.root}`)
      const domains: Partial<Record<StoreDomainId, string>> = {}
      for (const domain of Object.keys(values) as StoreDomainId[]) {
        const value = values[domain]
        if (value === undefined) continue
        domains[domain] = await this.writeObject(value)
      }
      const commit = this.buildCommit(null, domains, null, source)
      await this.writeCommit(commit)
      await this.writeHeadIfAbsent(commit)
      return { commitId: commit.commitId, domains: values, tree: null }
    })
  }

  /**
   * Delete commit/object files no longer reachable from the retained head
   * chain. Deletion failures are reported, never thrown: an orphan file only
   * wastes space; a reachable snapshot is never broken by this pass.
   */
  async collectGarbage(retain = 64, objectGraceMs = 300_000): Promise<StoreGarbageCollectionResult> {
    const limit = Number.isInteger(retain) && retain >= 2 ? retain : 64
    const grace = Number.isFinite(objectGraceMs) && objectGraceMs > 0 ? objectGraceMs : 0
    return await this.fence.run(async () => {
      const head = await this.readHead()
      if (head === null) return { commits: [], objects: [], failures: [] }
      const keepCommits = new Set<string>()
      const keepObjects = new Set<string>()
      let cursor: string | null = head.commitId
      while (cursor !== null && keepCommits.size < limit) {
        keepCommits.add(cursor)
        const commit = await this.readCommitById(cursor)
        for (const hash of Object.values(commit.domains)) if (hash !== undefined) keepObjects.add(hash)
        if (commit.tree?.manifest !== undefined) keepObjects.add(commit.tree.manifest)
        cursor = commit.parent
      }
      const removedCommits: string[] = []
      const removedObjects: string[] = []
      const failures: Array<{ path: string; error: Error }> = []
      const remove = async (path: string): Promise<boolean> => {
        try {
          await this.io.remove(path)
          return true
        } catch (error) {
          failures.push({ path, error: error instanceof Error ? error : new Error(String(error)) })
          return false
        }
      }
      for (const name of await this.io.list(join(this.root, COMMITS_DIR))) {
        const id = name.endsWith('.json') ? name.slice(0, -5) : ''
        if (!/^[0-9a-f]{64}$/.test(id) || keepCommits.has(id)) continue
        const path = join(this.root, COMMITS_DIR, name)
        if (await remove(path)) removedCommits.push(id)
      }
      for (const name of await this.io.list(join(this.root, OBJECTS_DIR))) {
        const id = name.endsWith('.json') ? name.slice(0, -5) : ''
        if (!/^[0-9a-f]{64}$/.test(id) || keepObjects.has(id)) continue
        const path = join(this.root, OBJECTS_DIR, name)
        // A manifest object is published before its commit/head; a concurrent GC
        // that only sees the old head must not delete that young object.
        if (grace > 0 && this.io.mtime !== undefined) {
          const modified = await this.io.mtime(path)
          if (modified !== null && Date.now() - modified < grace) continue
        }
        if (await remove(path)) removedObjects.push(id)
      }
      return { commits: removedCommits, objects: removedObjects, failures }
    })
  }

  private async readHead(): Promise<StoreHead | null> {
    const path = join(this.root, HEAD_FILE)
    const text = await this.io.readText(path)
    return text === null ? null : parseHead(text, path)
  }

  /** A lock-free reader can transiently miss a just-replaced file on Windows; retry a bounded few times. */
  private async readHeadForQuery(): Promise<StoreHead | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const head = await this.readHead()
      if (head !== null) return head
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)))
    }
    return null
  }

  private async readCommit(head: StoreHead): Promise<StoreCommit> {
    const path = join(this.root, COMMITS_DIR, head.commitId + '.json')
    const text = await this.io.readText(path)
    if (text === null) throw new StoreCorruptError(`${path}: commit is missing while head names it`)
    if (sha256(text) !== head.commitSha256) throw new StoreCorruptError(`${path}: head commitSha256 does not match the commit bytes`)
    return parseCommit(text, path)
  }

  private async readCommitById(commitId: string): Promise<StoreCommit> {
    const path = join(this.root, COMMITS_DIR, commitId + '.json')
    const text = await this.io.readText(path)
    if (text === null) throw new StoreCorruptError(`${path}: commit is missing during garbage collection`)
    return parseCommit(text, path)
  }

  /** Publish an immutable content object and return its sha256. */
  async putObject(value: unknown): Promise<string> {
    return await this.writeObject(value)
  }

  /** Read one content object, verifying its content address. */
  async getObject(objectId: string): Promise<unknown> {
    if (!/^[0-9a-f]{64}$/.test(objectId)) throw new StoreError('store-invalid-object', 'object id must be a sha256')
    return await this.readObject(objectId)
  }

  private async resolveDomains(commit: StoreCommit, domains: readonly StoreDomainId[]): Promise<StoreSnapshot> {
    const values: StoreDomainValues = {}
    for (const domain of domains) {
      const objectId = commit.domains[domain]
      if (objectId === undefined) continue
      values[domain] = await this.readObject(objectId)
    }
    return deepFreeze({ commitId: commit.commitId, domains: values, tree: commit.tree })
  }

  private async readObject(objectId: string): Promise<unknown> {
    const path = join(this.root, OBJECTS_DIR, objectId + '.json')
    const text = await this.io.readText(path)
    if (text === null) throw new StoreCorruptError(`${path}: content object is missing`)
    if (sha256(text) !== objectId) throw new StoreCorruptError(`${path}: content object bytes do not match its id`)
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      throw new StoreCorruptError(`${path}: content object is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async writeObject(value: unknown): Promise<string> {
    const text = stableStringify(value)
    const objectId = sha256(text)
    await this.writeImmutable(join(this.root, OBJECTS_DIR, objectId + '.json'), text)
    return objectId
  }

  private async writeCommit(commit: StoreCommit): Promise<void> {
    await this.writeImmutable(join(this.root, COMMITS_DIR, commit.commitId + '.json'), stableStringify(commit))
  }

  private async writeImmutable(path: string, text: string): Promise<void> {
    if (this.io.createTextIfAbsent !== undefined) {
      try {
        await this.io.createTextIfAbsent(path, text)
        return
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'EEXIST') throw error
      }
    }
    const existing = await this.io.readText(path)
    if (existing === null) {
      // A backend without createTextIfAbsent still gets a complete atomic file;
      // a concurrent writer of the same content object writes identical bytes.
      await this.io.writeText(path, text)
      return
    }
    if (existing !== text) throw new StoreImmutableConflictError(path)
  }

  private async writeHead(commit: StoreCommit): Promise<void> {
    const head: StoreHead = {
      schemaVersion: SCHEMA_VERSION,
      commitId: commit.commitId,
      commitSha256: sha256(stableStringify(commit)),
      updatedAt: new Date(this.now()).toISOString(),
    }
    await this.io.writeText(join(this.root, HEAD_FILE), stableStringify(head))
  }

  private async writeHeadIfAbsent(commit: StoreCommit): Promise<void> {
    const head: StoreHead = {
      schemaVersion: SCHEMA_VERSION,
      commitId: commit.commitId,
      commitSha256: sha256(stableStringify(commit)),
      updatedAt: new Date(this.now()).toISOString(),
    }
    const path = join(this.root, HEAD_FILE)
    if (this.io.createTextIfAbsent !== undefined) {
      try {
        await this.io.createTextIfAbsent(path, stableStringify(head))
        return
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'EEXIST') throw error
      }
    }
    if (await this.readHead() !== null) throw new StoreError('store-already-initialized', `home MVCC store already has a head at ${this.root}`)
    await this.io.writeText(path, stableStringify(head))
  }

  private buildCommit(parent: string | null, domains: Partial<Record<StoreDomainId, string>>, tree: StoreTreeRef | null, source: StoreCommitSource): StoreCommit {
    const normalizedTree = normalizeTree(tree)
    if (!(STORE_COMMIT_SOURCES as readonly string[]).includes(source)) {
      throw new StoreError('store-invalid-source', `unknown commit source "${String(source)}"`)
    }
    const draft = {
      schemaVersion: SCHEMA_VERSION,
      parent,
      createdAt: new Date(this.now()).toISOString(),
      domains,
      tree: normalizedTree,
      source,
    }
    const commitId = sha256(stableStringify(draft))
    const commit: StoreCommit = { ...draft, commitId }
    // A commit that this kernel publishes must be readable by the same schema;
    // normalize/validate BEFORE the head points at it, otherwise a wider
    // runtime object could permanently lock the head out of every reader.
    parseCommit(stableStringify(commit), '<built commit>')
    return commit
  }
}

/** Reject/normalize a tree reference at the write boundary; extra runtime keys never reach disk. */
function normalizeTree(tree: StoreTreeRef | null): StoreTreeRef | null {
  if (tree === null) return null
  if (typeof tree.unitId !== 'string' || tree.unitId.trim() === '') {
    throw new StoreError('store-invalid-tree', 'tree.unitId must be a non-empty string')
  }
  if (tree.manifest !== undefined && !/^[0-9a-f]{64}$/.test(tree.manifest)) {
    throw new StoreError('store-invalid-tree', 'tree.manifest must be a sha256 when present')
  }
  return tree.manifest === undefined ? { unitId: tree.unitId } : { unitId: tree.unitId, manifest: tree.manifest }
}

const sameTree = (left: StoreTreeRef | null, right: StoreTreeRef | null): boolean => {
  if (left === null || right === null) return left === right
  return left.unitId === right.unitId && left.manifest === right.manifest
}
