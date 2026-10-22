/** Pure approve-claim lease. No IO. */
export interface Claim {
  readonly id: string
  readonly token: string
  readonly expiresAt: number
}

export function acquireClaim(current: Claim | undefined, now: number, leaseMs: number, token: string): Claim | undefined {
  if (current !== undefined && current.expiresAt > now) return undefined
  return { id: 'claim', token, expiresAt: now + Math.max(1, leaseMs) }
}

export function releaseClaim(current: Claim | undefined, token: string): Claim | undefined {
  return current?.token === token ? undefined : current
}

export function isClaimExpired(current: Claim | undefined, now: number): boolean {
  return current !== undefined && current.expiresAt <= now
}
