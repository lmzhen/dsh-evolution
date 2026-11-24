/**
 * Home MVCC store vocabulary.
 *
 * The store owns immutable content objects and one atomic head pointer. A
 * commit maps each durable domain to the content object that was current when
 * the commit was published; readers resolve one commit and therefore see every
 * participating domain at the same generation without taking a writer lock.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/types
 */

/** Every durable domain the family's MVCC store may carry. */
export const STORE_DOMAIN_IDS = [
  'state',
  'merge',
  'mergeMeta',
  'runs',
  'usage',
  'suppressed',
  'feedback',
  'memory',
  'discovery',
  'domainMap',
  'projectionJournal',
  'viewSnapshots',
  'reports',
] as const

/** One durable domain id. */
export type StoreDomainId = (typeof STORE_DOMAIN_IDS)[number]

/** Domain values as published by one commit; a missing key means the domain has no current value. */
export type StoreDomainValues = Partial<Record<StoreDomainId, unknown>>

/** Why a commit was published. Diagnostics only; never used for authority. */
export type StoreCommitSource = 'foreground' | 'background_review' | 'command' | 'ui' | 'tool' | 'bootstrap'

/** The durable source values a published commit may carry. */
export const STORE_COMMIT_SOURCES: readonly StoreCommitSource[] = [
  'foreground',
  'background_review',
  'command',
  'ui',
  'tool',
  'bootstrap',
]

/** A skill-tree unit published together with this commit. */
export interface StoreTreeRef {
  readonly unitId: string
  /** Content object holding the tree manifest; absent until the tree-manifest phase lands. */
  readonly manifest?: string | undefined
}

/** The mutable head file. A single atomic replacement publishes one complete commit. */
export interface StoreHead {
  readonly schemaVersion: number
  readonly commitId: string
  readonly commitSha256: string
  readonly updatedAt: string
}

/** The immutable commit manifest stored at `commits/<commitId>.json`. */
export interface StoreCommit {
  readonly schemaVersion: number
  readonly commitId: string
  readonly parent: string | null
  readonly createdAt: string
  readonly domains: Partial<Record<StoreDomainId, string>>
  readonly tree: StoreTreeRef | null
  readonly source: StoreCommitSource
}

/** A snapshot resolved from one commit. Every requested domain is from the same commit. */
export interface StoreSnapshot {
  readonly commitId: string
  readonly domains: StoreDomainValues
  readonly tree: StoreTreeRef | null
}

/** The result of a committed mutation. */
export interface StoreCommitResult {
  readonly commitId: string
  readonly domains: StoreDomainValues
  readonly tree: StoreTreeRef | null
}

/**
 * The writer critical section. `HomeFence` satisfies this shape: a nested
 * caller reuses the already-held tree scope instead of acquiring a second
 * cross-process lock.
 */
export interface StoreWriterFence {
  run<T>(body: () => Promise<T>): Promise<T>
}

/** One caller's request to publish a new commit. */
export interface StoreMutation {
  /** Domains whose values the mutator may change. */
  readonly domains: readonly StoreDomainId[]
  /** Reject the mutation when the head no longer matches this commit. */
  readonly expectedHead?: string | undefined
  readonly source: StoreCommitSource
  /**
   * Receives the complete current domain map and returns only the changed
   * domains. Absent keys keep the previous content object.
   */
  readonly change: (current: StoreSnapshot) => StoreDomainValues | Promise<StoreDomainValues>
  /** Attach a tree unit to the commit (the unit itself is committed by UnitKernel). */
  readonly tree?: StoreTreeRef | null | undefined
}

/** The result of a garbage-collection pass; failures are reported, never thrown after the head is safe. */
export interface StoreGarbageCollectionResult {
  readonly commits: string[]
  readonly objects: string[]
  readonly failures: Array<{ readonly path: string; readonly error: Error }>
}

/** Options for {@link StoreKernel}. */
export interface StoreKernelOptions {
  readonly io: import('../io.ts').EvolutionIoLike
  /** Evolution home; the store lives at `<home>/store-v2`. */
  readonly home: string
  /** The one home writer fence. Reads never touch it. */
  readonly fence: StoreWriterFence
  readonly now?: (() => number) | undefined
  /** Test seam: override the store directory. */
  readonly storeDir?: string | undefined
}

/** Base class for every store refusal. */
export class StoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

/** No head has been published yet; a caller must bootstrap explicitly. */
export class StoreNotInitializedError extends StoreError {
  constructor(home: string) {
    super('store-not-initialized', `home MVCC store is not initialized at ${home}; run the explicit bootstrap/migration first`)
    this.name = 'StoreNotInitializedError'
  }
}

/** Head/commit/object bytes are missing, unparseable, or fail their content hash. */
export class StoreCorruptError extends StoreError {
  constructor(message: string) {
    super('store-corrupt', message)
    this.name = 'StoreCorruptError'
  }
}

/** The caller's expected head is no longer current. */
export class StoreConflictError extends StoreError {
  readonly currentHead: string

  constructor(expected: string, current: string) {
    super('store-conflict', `store head changed: expected ${expected}, current ${current}`)
    this.name = 'StoreConflictError'
    this.currentHead = current
  }
}

/** An immutable file already exists with different bytes. */
export class StoreImmutableConflictError extends StoreError {
  constructor(path: string) {
    super('store-immutable-conflict', `immutable store file already exists with different content: ${path}`)
    this.name = 'StoreImmutableConflictError'
  }
}
