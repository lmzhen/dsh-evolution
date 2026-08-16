/**
 * Durable evolution state.
 *
 * Uses `ctx.storageDomain` when mounted; otherwise falls back to the same
 * JSON state files used by the legacy facade. Consumers see one async API.
 * @module @deepseek-ai/dsh-evolution-state
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

function stateHome(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'evolution')
}

class JsonState<T> {
  private value: T
  private readonly path: string
  constructor(name: string, initial: T) {
    this.path = join(stateHome(), name)
    this.value = initial
    try {
      this.value = { ...initial, ...JSON.parse(readFileSync(this.path, 'utf8')) as T }
    } catch {
      // fresh file
    }
  }
  get(): T { return this.value }
  update(fn: (value: T) => void): void { fn(this.value) }
  async flush(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(tmp, JSON.stringify(this.value, null, 2), 'utf8')
    await rename(tmp, this.path)
  }
}

export interface ReviewStateRecord {
  turnsSinceMemory: number
  turnsSinceSkill: number
  lastTurn: number
}

export interface CuratorStateRecord {
  lastRunAt: number
  runCount: number
  lastSummary: string
  paused: boolean
}

export interface PendingRecord {
  id: string
  kind: 'memory' | 'skill'
  summary: string
  args: unknown
  createdAt: string
  status: 'pending' | 'approved' | 'rejected'
  resolvedAt?: string | undefined
}

export const reviewStateSchema = z.object({
  turnsSinceMemory: z.number().int().nonnegative(),
  turnsSinceSkill: z.number().int().nonnegative(),
  lastTurn: z.number().int().nonnegative(),
})

export const curatorStateSchema = z.object({
  lastRunAt: z.number().nonnegative(),
  runCount: z.number().int().nonnegative(),
  lastSummary: z.string(),
  paused: z.boolean(),
})

export const pendingSchema = z.object({
  id: z.string(),
  kind: z.union([z.literal('memory'), z.literal('skill')]),
  summary: z.string(),
  args: z.unknown(),
  createdAt: z.string(),
  status: z.union([z.literal('pending'), z.literal('approved'), z.literal('rejected')]),
  resolvedAt: z.string().optional(),
})

export const EVOLUTION_DOMAIN = defineDomain({
  name: 'evolution',
  version: 1,
  tables: {
    review_state: domainTable<string, ReviewStateRecord>(reviewStateSchema),
    curator_state: domainTable<string, CuratorStateRecord>(curatorStateSchema),
    pending: domainTable<string, PendingRecord>(pendingSchema),
  },
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionState: EvolutionState
  }
}

interface DomainLike {
  table<N extends 'review_state' | 'curator_state' | 'pending'>(name: N): {
    get(key: string): (N extends 'review_state' ? ReviewStateRecord : N extends 'curator_state' ? CuratorStateRecord : PendingRecord) | undefined
    put(key: string, value: N extends 'review_state' ? ReviewStateRecord : N extends 'curator_state' ? CuratorStateRecord : PendingRecord): Promise<void>
    delete(key: string): Promise<boolean>
    entries?(): IterableIterator<[string, PendingRecord]>
  }
}

interface StorageDomainLike {
  open(spec: typeof EVOLUTION_DOMAIN): Promise<DomainLike>
}

export class EvolutionState extends Service {
  private readonly reviewJson = new JsonState<Record<string, ReviewStateRecord>>('review-state.json', {})
  private readonly curatorJson = new JsonState<Record<string, CuratorStateRecord>>('curator-state.json', {})
  private readonly pendingJson = new JsonState<Record<string, PendingRecord>>('pending-state.json', {})
  private domain: DomainLike | null = null
  private domainPromise: Promise<DomainLike> | null = null

  constructor(ctx: Context) {
    super(ctx, 'evolutionState')
    this.ctx.effect(() => () => { this.domain = null }, 'evolution-state.domain-reset')
  }

  private async ensureDomain(): Promise<DomainLike | null> {
    if (this.domain) return this.domain
    const facility = this.ctx.get('storageDomain') as StorageDomainLike | undefined
    if (!facility) return null
    this.domainPromise ??= facility.open(EVOLUTION_DOMAIN)
    this.domain = await this.domainPromise
    return this.domain
  }

  async loadReviewState(sessionId: string): Promise<ReviewStateRecord | null> {
    const domain = await this.ensureDomain()
    if (domain) return domain.table('review_state').get(sessionId) ?? null
    return this.reviewJson.get()[sessionId] ?? null
  }

  async saveReviewState(sessionId: string, record: ReviewStateRecord): Promise<void> {
    const domain = await this.ensureDomain()
    if (domain) await domain.table('review_state').put(sessionId, record)
    else {
      this.reviewJson.update(value => { value[sessionId] = record })
      await this.reviewJson.flush()
    }
  }

  async loadCuratorState(): Promise<CuratorStateRecord | null> {
    const domain = await this.ensureDomain()
    if (domain) return domain.table('curator_state').get('primary') ?? null
    return this.curatorJson.get().primary ?? null
  }

  async saveCuratorState(record: CuratorStateRecord): Promise<void> {
    const domain = await this.ensureDomain()
    if (domain) await domain.table('curator_state').put('primary', record)
    else {
      this.curatorJson.update(value => { value.primary = record })
      await this.curatorJson.flush()
    }
  }

  async listPending(status: PendingRecord['status'] = 'pending'): Promise<PendingRecord[]> {
    const domain = await this.ensureDomain()
    if (domain) return [...domain.table('pending').entries?.() ?? []].map(([, value]) => value).filter(record => record.status === status)
    return Object.values(this.pendingJson.get()).filter(record => record.status === status)
  }

  async savePending(record: PendingRecord): Promise<void> {
    const domain = await this.ensureDomain()
    if (domain) await domain.table('pending').put(record.id, record)
    else {
      this.pendingJson.update(value => { value[record.id] = record })
      await this.pendingJson.flush()
    }
  }

  async deletePending(id: string): Promise<void> {
    const domain = await this.ensureDomain()
    if (domain) await domain.table('pending').delete(id)
    else {
      this.pendingJson.update(value => { delete value[id] })
      await this.pendingJson.flush()
    }
  }
}

export default EvolutionState
