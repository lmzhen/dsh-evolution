/**
 * G2b/2b.3: which medium carries each record type, and what PROCESS SCOPE that medium actually gives.
 *
 * The family has two serialization layers and only ever wrote one of them down, for the json provider: the
 * IO backend cross-process transact lock (first layer) and the caller own in-process chain (second). The
 * domain medium inherits its answer from whatever backend the platform storage facility routes, and nothing
 * stated it. So this file states it - and the criterion is the family one: a CLAIM must be produced by a
 * capability that can be DISPROVED. processScopeViolations takes the io the provider writes through and
 * reports every claim of cross-process that the io cannot back up.
 *
 * MIGRATION NOTE: the plan allows naming storage-sqlite for a cross-process record type. That package does
 * not exist in this tree (0 hits), so today every entry is either backed by the IO transact lock or
 * declares single-process. When a backend carrying its own cross-process guarantee lands, it is named here
 * and the reasoning moves with it - one declaration, not two.
 *
 * @module @deepseek-ai/dsh-evolution-state-storage/medium-declaration
 */

/** One record type: its medium, the process scope claimed for it, and why that is true. */
export interface MediumProcessClaim {
  /** The record family, named as the domain declares it. */
  readonly record: string
  readonly medium: 'json' | 'domain'
  /** cross-process is a CLAIM: processScopeViolations refuses it without a backing transact. */
  readonly scope: 'cross-process' | 'single-process'
  readonly because: string
}

/** The declaration. */
export const MEDIUM_PROCESS_DECLARATION: readonly MediumProcessClaim[] = [
  {
    record: 'review_state',
    medium: 'json',
    scope: 'cross-process',
    because: 'the json provider serializes through the IO backend transact lock, as its README states',
  },
  {
    record: 'curator_state',
    medium: 'json',
    scope: 'cross-process',
    because: 'same provider and same lock as review_state; the run bookkeeping rides the same write path',
  },
  {
    record: 'pending',
    medium: 'json',
    scope: 'cross-process',
    because: 'a staged write is claimed by name across processes, so it needs the lock more than the other two',
  },
  {
    record: 'evolution-domain',
    medium: 'domain',
    scope: 'single-process',
    because: 'no backend in this tree carries its own cross-process guarantee and none is named, so the domain facility lock semantics stay the backend business and this declares the weaker truth',
  },
]

/** The capability the claims are checked against: the io the medium writes through. */
export interface ProcessScopeProbe {
  /** The IO backend transact entry point, when it has one. */
  readonly transact?: unknown
}

/**
 * Falsify the declaration against a capability reading.
 * @param io - the io backend the medium writes through, or undefined when none is mounted.
 * @returns one message per claim the capability cannot back up; empty when every claim holds.
 */
export function processScopeViolations(io: ProcessScopeProbe | undefined): readonly string[] {
  const backed = typeof io?.transact === 'function'
  return MEDIUM_PROCESS_DECLARATION
    .filter((claim) => claim.scope === 'cross-process' && !backed)
    .map((claim) => claim.record + ' claims cross-process (' + claim.because + ') but the mounted io exposes no transact lock')
}
