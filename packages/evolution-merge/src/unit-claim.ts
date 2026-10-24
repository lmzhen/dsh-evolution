import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { acquireTargetClaim, releaseTargetClaimQuietly } from './target-claim.ts'
import type { UnitClaim, UnitClaimPort } from '@deepseek-ai/dsh-evolution-core'

/** Commit-phase claim: 24h is only stale recovery; commit releases immediately, no approve TTL. */
export function targetClaimUnitPort(io: EvolutionIoLike, home: string, now: () => number): UnitClaimPort {
  return {
    async acquire(target: string): Promise<UnitClaim> {
      const claim = await acquireTargetClaim(io, home, target, now())
      if (claim === null) throw new Error('target-claim-busy: ' + target)
      return {
        async release() { await releaseTargetClaimQuietly(claim) },
      }
    },
  }
}
