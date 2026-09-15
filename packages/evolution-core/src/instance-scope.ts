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
 *
 * ## Scope (v43 FLOW2-1) — this registry is PER PROCESS
 *
 * `claims` below is a module-scope Map: two ROWS over one home in ONE process
 * contend, while the SAME home in another process gets its own Map and is
 * granted the key. That is by construction, not a gap to close here — the
 * cross-process half of the contract is the IO backend's write lock
 * (`transactIo`, core/io.ts), which serializes a per-target read-modify-write.
 * The FLOW2-1 finding was three call sites reading a GRANTED claim as "no other
 * process can be doing this work", so the caller contract is stated here:
 * - granted means "no other row OF THIS PROCESS owns the key";
 * - `instanceHolder()` answers "who holds it HERE"; `undefined` also covers
 *   "held by another process";
 * - a foreign holder's LIVENESS cannot be decided from a claim at all (no pid
 *   is recorded here): a consumer that needs that decision must carry a pid in
 *   its own credential and probe it (`isProcessAlive`, core/io.ts), or state
 *   that its action is destructive.
 * @module @deepseek-ai/dsh-evolution-core/src/instance-scope
 */

/** Outcome of a claim. `holder` is the current owner either way. */
export interface InstanceClaimResult {
  readonly granted: boolean
  readonly key: string
  readonly holder: string
}

/** home+key -> holder, IN THIS PROCESS ONLY. The Map is module-scope, so two
 * processes never share it: this half cannot exclude another process (v43
 * FLOW2-1) — the cross-process half is the write lock, see
 * persisted-write-inventory.json. It is still the whole point for the case it
 * was written for: two ROWS of one process writing one home. */
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

/** The current holder of `key` at `home`, IN THIS PROCESS, or undefined
 * (which also covers "another process holds it" — v43 FLOW2-1). */
export function instanceHolder(home: string, key: string): string | undefined {
  return claims.get(instanceClaimKey(home, key))
}
