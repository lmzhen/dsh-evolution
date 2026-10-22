/** Durable target claim: one approve writer per merge target at a time. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { contentHash, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { acquireClaim, releaseClaim, type Claim } from './domain/claim.ts'

const LEASE_MS = 5 * 60_000

function claimPath(home: string, target: string): string {
  return join(home, 'merge', 'claims', contentHash(target) + '.json')
}

async function readClaim(io: EvolutionIoLike, home: string, target: string): Promise<Claim | undefined> {
  try {
    const raw = await io.readText(claimPath(home, target))
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as Partial<Claim>
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return undefined
    return { id: 'claim', token: parsed.token, expiresAt: parsed.expiresAt }
  } catch {
    return undefined
  }
}

export interface TargetClaim {
  readonly token: string
  release(): Promise<void>
}

export async function acquireTargetClaim(io: EvolutionIoLike, home: string, target: string, now: number): Promise<TargetClaim | null> {
  const current = await readClaim(io, home, target)
  const token = randomUUID()
  const claim = acquireClaim(current, now, LEASE_MS, token)
  if (claim === undefined) return null
  await io.writeText(claimPath(home, target), JSON.stringify(claim) + '\n')
  return {
    token,
    async release() {
      const latest = await readClaim(io, home, target)
      const next = releaseClaim(latest, token)
      if (next === undefined) {
        try { await io.remove(claimPath(home, target)) } catch { /* already gone */ }
      } else {
        await io.writeText(claimPath(home, target), JSON.stringify(next) + '\n')
      }
    },
  }
}
