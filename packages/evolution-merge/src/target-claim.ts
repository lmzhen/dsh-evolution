/** Durable target claim: one approve writer per merge target at a time. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { contentHash, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { acquireClaim, releaseClaim, type Claim } from './domain/claim.ts'

const LEASE_MS = 30 * 60_000

function claimPath(home: string, target: string): string {
  return join(home, 'merge', 'claims', contentHash(target) + '.json')
}

function parseClaim(raw: string | null): Claim | undefined {
  if (raw === null) return undefined
  const parsed = JSON.parse(raw) as Partial<Claim>
  if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') throw new Error('corrupt target claim')
  return { id: 'claim', token: parsed.token, expiresAt: parsed.expiresAt }
}

async function compareAndSwap(io: EvolutionIoLike, path: string, task: (current: string | null) => string | null): Promise<void> {
  if (io.transact !== undefined) {
    await io.transact(path, current => task(current))
    return
  }
  const current = (await io.exists(path)) ? await io.readText(path) : null
  const next = task(current)
  if (next === null) {
    if (current !== null) try { await io.remove(path) } catch { /* already gone */ }
  } else if (next !== current) {
    await io.writeText(path, next)
  }
}

export interface TargetClaim {
  readonly token: string
  release(): Promise<void>
}

export async function acquireTargetClaim(io: EvolutionIoLike, home: string, target: string, now: number): Promise<TargetClaim | null> {
  const path = claimPath(home, target)
  const token = randomUUID()
  let granted: Claim | undefined
  await compareAndSwap(io, path, (raw) => {
    const claim = acquireClaim(parseClaim(raw), now, LEASE_MS, token)
    if (claim === undefined) return raw
    granted = claim
    return JSON.stringify(claim) + '\n'
  })
  if (granted === undefined) return null
  return {
    token,
    async release() {
      await compareAndSwap(io, path, (raw) => {
        const next = releaseClaim(parseClaim(raw), token)
        return next === undefined ? null : JSON.stringify(next) + '\n'
      })
    },
  }
}
