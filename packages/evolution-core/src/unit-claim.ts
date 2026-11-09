/** Shared target-claim port: one live unit per target across processes. */

export interface UnitClaim {
  release(): Promise<void>
}

export interface UnitClaimPort {
  acquire(target: string, runId: string): Promise<UnitClaim>
}
