/**
 * B3 / G4 (0.3.78): the family's single-instance contract, made explicit.
 *
 * Every persisted sidecar is written under TWO assumptions: the IO backend's
 * cross-process write lock serializes different processes, and exactly ONE
 * instance of each writer service exists per evolution home. The second half
 * was implicit — `makeSerialQueue()` and the module-scope stores are
 * per-instance, so two rows writing one home interleave inside one file (the
 * "two instances, one file" class). This module makes that half enforceable: a
 * writer CLAIMS its key while mounted and releases it on dispose, and a second
 * claimant is told who holds the key instead of silently racing it.
 *
 * The claim is keyed by the HOME, not by the process: the contended resource is
 * the sidecar directory, so two instances resolving different homes (an
 * isolated test fixture, a second DSH_HOME) do not contend, while two rows on
 * one profile do.
 * @module @deepseek-ai/dsh-evolution-core/src/instance-scope
 */

/** Outcome of a claim. `holder` is the current owner either way. */
export interface InstanceClaimResult {
  readonly granted: boolean
  readonly key: string
  readonly holder: string
}

/** home+key -> holder. Single-process by construction: a claim can only
 * serialize instances inside this process, which is the whole point (the
 * cross-process half is the write lock, see persisted-write-inventory.json). */
const claims = new Map<string, string>()

/** `<home> :: <key>` — the registry key, exported so diagnostics name the
 * same unit the claim does. */
export function instanceClaimKey(home: string, key: string): string {
  return `${home} :: ${key}`
}

/** Take the claim for `key` at `home`. Grants while it is free or already
 * held BY `owner` — remounting the same instance is not a second instance. */
export function claimInstance(home: string, key: string, owner: string): InstanceClaimResult {
  const id = instanceClaimKey(home, key)
  const current = claims.get(id)
  if (current === undefined || current === owner) {
    claims.set(id, owner)
    return { granted: true, key: id, holder: owner }
  }
  return { granted: false, key: id, holder: current }
}

/** Release only the claim `owner` took — never another instance's. */
export function releaseInstance(home: string, key: string, owner: string): void {
  const id = instanceClaimKey(home, key)
  if (claims.get(id) === owner) claims.delete(id)
}

/** The current holder of `key` at `home`, or undefined. */
export function instanceHolder(home: string, key: string): string | undefined {
  return claims.get(instanceClaimKey(home, key))
}
