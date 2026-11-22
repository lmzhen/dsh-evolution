/**
 * The agents half of the family's platform contract.
 *
 * The platform no longer maintains a runtime parent/child tree; root identity is
 * derived from the exact live registry entry and its session origin.
 */
import type { Context } from '@deepseek-ai/cordis'

/** The part of an Agent this port needs; the platform Agent has more fields. */
export interface AgentIdentity {
  readonly id: string
  readonly ctx?: Context
  readonly session?: {
    readonly header?: {
      readonly origin?: string
    }
  }
}

export interface AgentsPort {
  /** @returns the live agent registered under this id, if any. */
  get(id: string): AgentIdentity | undefined
  /** @returns every live agent, or an empty list when the service has no list face. */
  list(): readonly AgentIdentity[]
  /**
   * Whether the agent is an exact live registry entry and is not a subagent.
   * This mirrors `user-questions`'s `assertLiveRoot` without importing it.
   */
  isRoot(agent: AgentIdentity): boolean
}
