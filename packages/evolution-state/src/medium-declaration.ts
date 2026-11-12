/**
 * G2b/2b.3: which medium carries each record type, and what PROCESS SCOPE that medium actually gives.
 *
 * The shipped IO backend declares single-process: its transaction serializes one process only.
 * The domain medium inherits whatever backend the platform storage facility routes, and that is also
 * single-process in this tree. This file states the weaker truth. processScopeViolations takes the io the
 * provider writes through and reports every claim of cross-process that the io cannot back up.
 *
 * MIGRATION NOTE: when a platform backend carrying its own cross-process guarantee lands, name it here and
 * move the reasoning with it - one declaration, not two.
 *
 * @module @deepseek-ai/dsh-evolution-state/storage/medium-declaration
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
    scope: 'single-process',
    because: 'the shipped IO backend declares single-process; no cross-process medium exists in this tree',
  },
  {
    record: 'curator_state',
    medium: 'json',
    scope: 'single-process',
    because: 'same provider and same single-process write path as review_state',
  },
  {
    record: 'pending',
    medium: 'json',
    scope: 'single-process',
    because: 'the shipped IO backend has no cross-process claim primitive; a staged write is serialized only in-process',
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
  /** The scope the backend actually declares; `transact` alone is not proof. */
  readonly processScope?: 'single-process' | 'cross-process' | undefined
}

/**
 * Falsify the declaration against a capability reading.
 * @param io - the io backend the medium writes through, or undefined when none is mounted.
 * @param declaration - claims to falsify; defaults to the shipped declaration.
 * @returns one message per claim the capability cannot back up; empty when every claim holds.
 */
export function processScopeViolations(io: ProcessScopeProbe | undefined, declaration: readonly MediumProcessClaim[] = MEDIUM_PROCESS_DECLARATION): readonly string[] {
  const backed = io?.processScope === 'cross-process'
  return declaration
    .filter(claim => claim.scope === 'cross-process' && !backed)
    .map(claim => claim.record + ' claims cross-process (' + claim.because + ') but the mounted io declares ' + (io?.processScope ?? 'no process scope'))
}
