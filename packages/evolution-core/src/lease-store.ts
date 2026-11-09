import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { MutationOwner } from '@deepseek-ai/dsh-evolution-contract'
import type { EvolutionIoLike } from './io.ts'

/** One persisted run/claim lease. Epoch increments on every re-acquire. */
export interface LeaseRecord {
  readonly id: string
  readonly owner: MutationOwner
  readonly runId: string
  readonly pid: number
  readonly epoch: number
  readonly issuedAt: number
  readonly expiresAt: number
  readonly heartbeatAt: number
  readonly state: 'active' | 'released'
}

/** Caller-held proof of one active lease. */
export interface LeaseToken {
  readonly id: string
  readonly owner: MutationOwner
  readonly runId: string
  readonly epoch: number
}

export type LeaseAcquireResult =
  | { readonly ok: true; readonly lease: LeaseRecord; readonly token: LeaseToken }
  | { readonly ok: false; readonly reason: 'busy'; readonly holder: LeaseRecord }

export interface LeaseStoreOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly ttlMs?: number
  readonly now?: () => number
  readonly pid?: number
}

export const DEFAULT_LEASE_TTL_MS = 30_000

export function leaseFile(home: string, runId: string): string {
  return join(home, 'leases', encodeURIComponent(runId) + '.json')
}

function parseLease(raw: string | null): LeaseRecord | undefined {
  if (raw === null) return undefined
  try {
    const value = JSON.parse(raw) as Partial<LeaseRecord>
    if (typeof value.id !== 'string' || typeof value.runId !== 'string' || typeof value.owner !== 'string' || typeof value.pid !== 'number' || typeof value.epoch !== 'number' || typeof value.issuedAt !== 'number' || typeof value.expiresAt !== 'number' || typeof value.heartbeatAt !== 'number' || (value.state !== 'active' && value.state !== 'released')) return undefined
    return value as LeaseRecord
  } catch {
    return undefined
  }
}

async function transact(io: EvolutionIoLike, path: string, task: (current: string | null) => string | null): Promise<void> {
  if (io.transact !== undefined) {
    await io.transact(path, task)
    return
  }
  const current = await io.readText(path)
  const next = task(current)
  if (next === null) await io.remove(path)
  else if (next !== current) await io.writeText(path, next)
}

function tokenOf(record: LeaseRecord): LeaseToken {
  return { id: record.id, owner: record.owner, runId: record.runId, epoch: record.epoch }
}

/** Durable single-host lease store. One active lease per runId; expired leases are reclaimable. */
export class LeaseStore {
  private readonly io: EvolutionIoLike
  private readonly home: string
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly pid: number

  constructor(options: LeaseStoreOptions) {
    this.io = options.io
    this.home = options.home
    this.ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS
    this.now = options.now ?? Date.now
    this.pid = options.pid ?? process.pid
  }

  private path(runId: string): string {
    if (runId.trim() === '') throw new Error('lease runId must not be empty')
    return leaseFile(this.home, runId)
  }

  async acquire(owner: MutationOwner, runId: string, ttlMs = this.ttlMs): Promise<LeaseAcquireResult> {
    if (ttlMs <= 0) throw new Error('lease ttl must be positive')
    const path = this.path(runId)
    const now = this.now()
    let created: LeaseRecord | undefined
    let holder: LeaseRecord | undefined
    await transact(this.io, path, (raw) => {
      const current = parseLease(raw)
      if (current !== undefined && current.state === 'active' && now < current.expiresAt) {
        holder = current
        return raw
      }
      created = {
        id: randomUUID(),
        owner,
        runId,
        pid: this.pid,
        epoch: (current?.epoch ?? 0) + 1,
        issuedAt: now,
        expiresAt: now + ttlMs,
        heartbeatAt: now,
        state: 'active',
      }
      return JSON.stringify(created)
    })
    if (created !== undefined) return { ok: true, lease: created, token: tokenOf(created) }
    if (holder !== undefined) return { ok: false, reason: 'busy', holder }
    throw new Error('lease acquire did not create or observe a record')
  }

  async get(runId: string): Promise<LeaseRecord | null> {
    return parseLease(await this.io.readText(this.path(runId))) ?? null
  }

  async active(runId: string): Promise<LeaseRecord | null> {
    const record = await this.get(runId)
    return record !== null && record.state === 'active' && this.now() < record.expiresAt ? record : null
  }

  async renew(token: LeaseToken, ttlMs = this.ttlMs): Promise<LeaseRecord | null> {
    const path = this.path(token.runId)
    let next: LeaseRecord | null = null
    await transact(this.io, path, (raw) => {
      const current = parseLease(raw)
      if (current === undefined || current.state !== 'active' || current.id !== token.id || current.epoch !== token.epoch) return raw
      const now = this.now()
      next = { ...current, heartbeatAt: now, expiresAt: now + ttlMs }
      return JSON.stringify(next)
    })
    return next
  }

  async release(token: LeaseToken): Promise<void> {
    const path = this.path(token.runId)
    await transact(this.io, path, (raw) => {
      const current = parseLease(raw)
      if (current === undefined || current.id !== token.id || current.epoch !== token.epoch) return raw
      return JSON.stringify({ ...current, state: 'released', heartbeatAt: this.now() })
    })
  }
}
