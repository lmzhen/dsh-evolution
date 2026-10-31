import { createHash } from 'node:crypto'
import type { DomainMapSnapshot, DomainMapStore, DomainNode, SkillDomainEdge } from './domain-map.ts'
import { DomainMapVersionConflict } from './domain-map-store.ts'
import { mintDomainId } from './domain-generation.ts'
import type { SkillKey } from './identity.ts'

/** Closed technical pending set; semantic uncertainty is not pending. */
export type AssignmentPendingReason = 'invalid-id' | 'unknown-domain' | 'map-version-stale' | 'new-domain-conflict' | 'schema-invalid' | 'queue-unavailable'

/** LLM proposal accepted by skill_manage create; code validates/mints. */
export interface AssignmentProposal {
  readonly mode: 'existing' | 'new'
  readonly id?: string | undefined
  readonly proposed?: { readonly title: string; readonly purpose: string; readonly inScope: readonly string[]; readonly outOfScope: readonly string[]; readonly triggers: readonly string[]; readonly evidenceSkillKeys: readonly string[] } | undefined
  readonly secondaryDomainIds?: readonly string[] | undefined
  readonly confidence: number
  readonly reason: string
  readonly needsReview?: boolean | undefined
  readonly mapVersion: string
}

/** One create-side queue submission. */
export interface AssignmentSubmission {
  readonly skillKey: SkillKey
  readonly threeFieldHash: string
  readonly modelInvocable: boolean
  readonly whenToUse?: string | undefined
  readonly proposal?: AssignmentProposal | undefined
  readonly now?: number | undefined
}

/** Queue entry; key is the idempotency key. */
export interface AssignmentQueueEntry {
  readonly key: string
  readonly submission: AssignmentSubmission
  readonly proposalDigest: string
  readonly createdAt: number
  status: 'queued' | 'pending' | 'applied' | 'provisional'
  pendingReason?: AssignmentPendingReason | undefined
}

/** Queue abstraction used by the one assignment service. */
export interface AssignmentQueue {
  enqueue(entry: { readonly key: string; readonly submission: AssignmentSubmission; readonly proposalDigest: string; readonly createdAt: number }): Promise<{ entry: AssignmentQueueEntry; duplicate: boolean }>
  update(key: string, status: AssignmentQueueEntry['status'], pendingReason?: AssignmentPendingReason): Promise<void>
}

/** In-memory idempotent queue; production adapter can persist by key. */
export class MemoryAssignmentQueue implements AssignmentQueue {
  private readonly entries = new Map<string, AssignmentQueueEntry>()
  async enqueue(input: { key: string; submission: AssignmentSubmission; proposalDigest: string; createdAt: number }): Promise<{ entry: AssignmentQueueEntry; duplicate: boolean }> {
    const existing = this.entries.get(input.key)
    if (existing !== undefined) return { entry: existing, duplicate: true }
    const entry: AssignmentQueueEntry = { ...input, status: 'queued' }
    this.entries.set(input.key, entry)
    return { entry, duplicate: false }
  }
  async update(key: string, status: AssignmentQueueEntry['status'], pendingReason?: AssignmentPendingReason): Promise<void> {
    const entry = this.entries.get(key)
    if (entry !== undefined) { entry.status = status; entry.pendingReason = pendingReason }
  }
  list(): readonly AssignmentQueueEntry[] { return [...this.entries.values()] }
}

/** Staged create: no queue entry until approval. */
export interface StagedAssignment {
  readonly id: string
  readonly submission: AssignmentSubmission
}

/** Result of submit/process; create failure never appears here. */
export type AssignmentResult =
  | { readonly kind: 'unclassified'; readonly reason: 'feature-off' | 'no-proposal' | 'not-model-invocable' }
  | { readonly kind: 'queued'; readonly entry: AssignmentQueueEntry; readonly duplicate: boolean }
  | { readonly kind: 'applied' | 'provisional'; readonly entry: AssignmentQueueEntry; readonly mapVersion: string }
  | { readonly kind: 'pending'; readonly entry: AssignmentQueueEntry; readonly reason: AssignmentPendingReason }

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

/** @returns idempotency key for one proposal observation. */
export function assignmentKey(input: { skillKey: SkillKey; threeFieldHash: string; proposalDigest: string; mapVersion: string }): string {
  return digest([input.skillKey, input.threeFieldHash, input.proposalDigest, input.mapVersion])
}

/** @returns stable proposal digest; undefined proposal is digest of null. */
export function proposalDigest(proposal: AssignmentProposal | undefined): string { return digest(proposal ?? null) }

/** @returns a closed-set pending reason or undefined when the proposal can enqueue. */
export function validateProposal(proposal: AssignmentProposal): AssignmentPendingReason | undefined {
  if (proposal.mode !== 'existing' && proposal.mode !== 'new') return 'schema-invalid'
  if (typeof proposal.confidence !== 'number' || proposal.confidence < 0 || proposal.confidence > 1 || typeof proposal.reason !== 'string' || typeof proposal.mapVersion !== 'string') return 'schema-invalid'
  if (proposal.mode === 'existing' && (typeof proposal.id !== 'string' || proposal.id.length === 0)) return 'invalid-id'
  if (proposal.mode === 'new') {
    const proposed = proposal.proposed
    if (proposed === undefined || proposed.title.trim().length === 0 || proposed.purpose.trim().length === 0 || proposed.inScope.length === 0 || proposed.outOfScope.length === 0 || proposed.triggers.length === 0) return 'new-domain-conflict'
  }
  return undefined
}

/** @returns true only when whenToUse is covered by in/out/triggers; names alone do not count. */
export function coveredByDomain(whenToUse: string, domain: Pick<DomainNode, 'inScope' | 'outOfScope' | 'triggers'>): boolean {
  const text = whenToUse.toLowerCase()
  if (text.length === 0) return false
  const out = domain.outOfScope.some(value => value.length > 0 && text.includes(value.toLowerCase()))
  if (out) return false
  return domain.triggers.some(value => value.length > 0 && text.includes(value.toLowerCase()))
    || domain.inScope.some(value => value.length > 0 && text.includes(value.toLowerCase()))
}

/** One assignment sidecar service; the only map write path for create. */
export class DomainAssignmentService {
  private readonly queue: AssignmentQueue
  private readonly store: DomainMapStore
  private readonly options: { readonly createClassificationEnabled: boolean; readonly createCardsAvailable?: boolean; readonly provisionalThreshold?: number; readonly now?: () => number }
  constructor(
    queue: AssignmentQueue,
    store: DomainMapStore,
    options: { readonly createClassificationEnabled: boolean; readonly createCardsAvailable?: boolean; readonly provisionalThreshold?: number; readonly now?: () => number },
  ) {
    this.queue = queue
    this.store = store
    this.options = options
  }

  /** Stage a create proposal without queueing it. */
  stage(submission: AssignmentSubmission): StagedAssignment {
    return { id: digest(['staged', submission.skillKey, submission.threeFieldHash]), submission }
  }

  /** Approve a staged create; only this call enqueues. */
  async approve(staged: StagedAssignment): Promise<AssignmentResult> {
    return this.submit(staged.submission)
  }

  /**
   * Submit a create proposal after SkillLibrary.create succeeded.
   * @param submission - skill identity, three-field hash, permission, proposal.
   * @returns queue/pending/unclassified; never rolls back create.
   */
  async submit(submission: AssignmentSubmission): Promise<AssignmentResult> {
    if (!this.options.createClassificationEnabled) return { kind: 'unclassified', reason: 'feature-off' }
    if (!submission.modelInvocable) return { kind: 'unclassified', reason: 'not-model-invocable' }
    if (submission.proposal === undefined) {
      if (this.options.createCardsAvailable === true) {
        const reason: AssignmentPendingReason = 'schema-invalid'
        return { kind: 'pending', entry: { key: digest(['missing-proposal', submission.skillKey, submission.threeFieldHash]), submission, proposalDigest: proposalDigest(undefined), createdAt: this.now(), status: 'pending', pendingReason: reason }, reason }
      }
      return { kind: 'unclassified', reason: 'no-proposal' }
    }
    const invalid = validateProposal(submission.proposal)
    const pdigest = proposalDigest(submission.proposal)
    const key = assignmentKey({ skillKey: submission.skillKey, threeFieldHash: submission.threeFieldHash, proposalDigest: pdigest, mapVersion: submission.proposal.mapVersion })
    let queued: { entry: AssignmentQueueEntry; duplicate: boolean }
    try {
      queued = await this.queue.enqueue({ key, submission, proposalDigest: pdigest, createdAt: submission.now ?? this.now() })
    } catch {
      return { kind: 'pending', entry: { key, submission, proposalDigest: pdigest, createdAt: submission.now ?? this.now(), status: 'pending', pendingReason: 'queue-unavailable' }, reason: 'queue-unavailable' }
    }
    if (invalid !== undefined) {
      await this.queue.update(key, 'pending', invalid)
      return { kind: 'pending', entry: { ...queued.entry, status: 'pending', pendingReason: invalid }, reason: invalid }
    }
    return { kind: 'queued', entry: queued.entry, duplicate: queued.duplicate }
  }

  /** Process one queued entry with the current map; CAS failure becomes pending. */
  async process(entry: AssignmentQueueEntry): Promise<AssignmentResult> {
    const proposal = entry.submission.proposal
    if (proposal === undefined) return { kind: 'pending', entry, reason: 'schema-invalid' }
    const current = await this.store.read()
    if (proposal.mapVersion !== current.mapVersion) {
      await this.queue.update(entry.key, 'pending', 'map-version-stale')
      return { kind: 'pending', entry: { ...entry, status: 'pending', pendingReason: 'map-version-stale' }, reason: 'map-version-stale' }
    }
    try {
      const next = buildNext(current, entry, proposal, this.options.provisionalThreshold ?? 3)
      const committed = await this.store.commit(current.mapVersion, { mapVersion: next.mapVersion, domains: next.domains, edges: next.edges })
      const status = next.provisional ? 'provisional' : 'applied'
      await this.queue.update(entry.key, status)
      return { kind: status, entry: { ...entry, status }, mapVersion: committed.mapVersion }
    } catch (error) {
      if (error instanceof DomainMapVersionConflict) {
        await this.queue.update(entry.key, 'pending', 'map-version-stale')
        return { kind: 'pending', entry: { ...entry, status: 'pending', pendingReason: 'map-version-stale' }, reason: 'map-version-stale' }
      }
      const reason = error instanceof Error && (error.message === 'unknown-domain' || error.message === 'new-domain-conflict' || error.message === 'schema-invalid')
        ? error.message as AssignmentPendingReason
        : 'queue-unavailable'
      await this.queue.update(entry.key, 'pending', reason)
      return { kind: 'pending', entry: { ...entry, status: 'pending', pendingReason: reason }, reason }
    }
  }

  /** Manually confirm one provisional domain; no semantic reclassification. */
  async confirm(domainId: string): Promise<boolean> {
    const current = await this.store.read()
    const domain = current.domains.find(node => node.id === domainId)
    if (domain === undefined || domain.status !== 'provisional') return false
    const domains = current.domains.map(node => node.id === domainId ? { ...node, status: 'active' as const, updatedAt: this.now() } : node)
    await this.store.commit(current.mapVersion, { mapVersion: nextMapVersion(current.mapVersion), domains, edges: current.edges })
    return true
  }

  private now(): number { return this.options.now?.() ?? Date.now() }
}

function nextMapVersion(version: string): string {
  const numeric = Number(version)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric + 1) : version + '+1'
}

function buildNext(current: DomainMapSnapshot, entry: AssignmentQueueEntry, proposal: AssignmentProposal, threshold: number): { mapVersion: string; domains: readonly DomainNode[]; edges: readonly SkillDomainEdge[]; provisional: boolean } {
  const edge: SkillDomainEdge = { skillKey: entry.submission.skillKey, domainId: '', role: 'primary', confidence: proposal.confidence, source: 'create', skillHash: entry.submission.threeFieldHash, mapVersion: nextMapVersion(current.mapVersion), status: 'active', assignedAt: entry.createdAt }
  const secondaries = (proposal.secondaryDomainIds ?? []).map(id => {
    const secondary = current.domains.find(node => node.id === id)
    if (secondary === undefined) throw new Error('unknown-domain')
    return { ...edge, domainId: secondary.id, role: 'secondary' as const }
  })
  if (proposal.mode === 'existing') {
    const domain = current.domains.find(node => node.id === proposal.id)
    if (domain === undefined) throw new Error('unknown-domain')
    if (!coveredByDomain(entry.submission.whenToUse ?? '', domain)) throw new Error('new-domain-conflict')
    const members = new Set(current.edges.filter(item => item.domainId === domain.id).map(item => item.skillKey))
    members.add(entry.submission.skillKey)
    const promote = domain.status === 'provisional' && members.size >= threshold
    const domains = promote ? current.domains.map(node => node.id === domain.id ? { ...node, status: 'active' as const, updatedAt: entry.createdAt } : node) : current.domains
    return { mapVersion: nextMapVersion(current.mapVersion), domains, edges: [...current.edges, { ...edge, domainId: domain.id }, ...secondaries.filter(secondary => secondary.domainId !== domain.id)], provisional: domain.status === 'provisional' && !promote }
  }
  const proposed = proposal.proposed
  if (proposed === undefined) throw new Error('schema-invalid')
  const normalizedTitle = proposed.title.trim().toLowerCase()
  const existing = current.domains.find(node => node.name.trim().toLowerCase() === normalizedTitle)
  if (existing !== undefined && existing.status !== 'provisional') throw new Error('new-domain-conflict')
  const id = existing?.id ?? mintDomainId(proposed.title)
  if (current.domains.some(node => node.id !== id && node.triggers.some(trigger => proposed.triggers.includes(trigger)))) throw new Error('new-domain-conflict')
  const domain: DomainNode = existing ?? {
    id, name: proposed.title, purpose: proposed.purpose, description: proposed.purpose,
    inScope: proposed.inScope, outOfScope: proposed.outOfScope, triggers: proposed.triggers, parentIds: [],
    status: 'provisional', version: 1, createdAt: entry.createdAt, updatedAt: entry.createdAt,
    descriptionHash: 'pending', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: { source: 'create' }, quality: {},
  }
  const members = new Set(current.edges.filter(item => item.domainId === id).map(item => item.skillKey))
  members.add(entry.submission.skillKey)
  const promote = members.size >= threshold
  const finalDomain = promote ? { ...domain, status: 'active' as const, updatedAt: entry.createdAt } : domain
  return { mapVersion: nextMapVersion(current.mapVersion), domains: existing === undefined ? [...current.domains, finalDomain] : current.domains.map(node => node.id === id ? finalDomain : node), edges: [...current.edges, { ...edge, domainId: id }, ...secondaries.filter(secondary => secondary.domainId !== id)], provisional: !promote }
}
