/**
 * G2b/2b.4: the domain compatibility declaration (S1-07).
 *
 * A domain spec says WHAT is stored; nothing said what happens to records the CURRENT schema rejects,
 * nor which earlier versions stay readable. Today the answer is implicit and unstated: 0 declared
 * compatibility surface. This file is the ONE place that states it.
 *
 * MIGRATION NOTE: upstream P2-E1 (docs/v33-no-action-register.md) asks storage-domain to add optional
 * `layout` / `compatibleVersions` / `invalidRecords` fields to `DomainSpec`. When that lands, this
 * declaration MOVES onto the platform spec - the fields exist precisely so a domain can state this once.
 * It must not then live in two places.
 *
 * @module @deepseek-ai/dsh-evolution-state-domain/compatibility
 */

/** How bad it is to lose one record of a table, by whether the data can come back. */
export type RecordLossTier = 'regenerable' | 'irreplaceable'

/** One table's answer to "what if a stored record fails the current schema?". */
export interface InvalidRecordPolicy {
  readonly table: string
  /** `regenerable`: the record can be rebuilt from another surface. `irreplaceable`: it cannot. */
  readonly tier: RecordLossTier
  /** Why that tier, in one line — the claim a reader can check. */
  readonly why: string
}

/**
 * The declaration. `compatibleVersions` and `layout` are ALTERNATIVES, not complements: a domain either
 * states which earlier format versions it still reads, or states the layout it expects - declaring both
 * would leave the reader two answers to one question. Exactly one must be present.
 */
export interface DomainCompatibility {
  /** One entry per declared table; a table with no entry is an unstated loss policy. */
  readonly invalidRecords: readonly InvalidRecordPolicy[]
  /** Earlier domain versions this build still opens. */
  readonly compatibleVersions?: readonly number[] | undefined
  /** The layout this build expects on the medium, when version compatibility is not the axis. */
  readonly layout?: string | undefined
}

/** The evolution domain's statement. Absence of this constant is what the criterion calls red. */
export const EVOLUTION_DOMAIN_COMPATIBILITY: DomainCompatibility = {
  invalidRecords: [
    {
      table: 'review_state',
      tier: 'regenerable',
      why: 'turn counters are observations of a session; a lost row costs one session its counters and the next run rewrites it',
    },
    {
      table: 'curator_state',
      tier: 'regenerable',
      why: 'run bookkeeping only — runCount/lastRunAt are re-derived from the run records on the next run',
    },
    {
      table: 'pending',
      tier: 'irreplaceable',
      why: 'a staged write is the ONLY copy of an approved-but-unapplied change; losing it loses the operator decision',
    },
  ],
  compatibleVersions: [1],
}
