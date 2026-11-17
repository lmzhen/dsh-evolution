/**
 * The agents half of the family's host platform boundary.
 *
 * The platform no longer maintains a runtime parent/child tree; root identity is
 * derived from the exact live registry entry and its session origin. Features
 * receive that rule here, not as a `roots()` call.
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

interface AgentsServiceLike {
  get(id: string): unknown
  list?(): readonly unknown[]
}

const asIdentity = (value: unknown): AgentIdentity | undefined => {
  if (value === null || typeof value !== 'object') return undefined
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? value as AgentIdentity : undefined
}

/** Resolve the agents port; undefined means the host has no agents service. */
export function agentsPort(ctx: Context): AgentsPort | undefined {
  // platform-declaration anchor: agents is declared in core PLATFORM_SERVICE_PROBES.
  const agents = ctx.get('agents') as AgentsServiceLike | undefined
  if (agents === undefined) return undefined
  if (typeof agents.get !== 'function' && typeof agents.list !== 'function') return undefined
  const get = typeof agents.get === 'function' ? agents.get.bind(agents) : undefined
  const list = typeof agents.list === 'function' ? agents.list.bind(agents) : undefined
  return {
    get: (id) => get === undefined ? undefined : asIdentity(get(id)),
    list: () => list === undefined ? [] : list().map(asIdentity).filter((agent): agent is AgentIdentity => agent !== undefined),
    isRoot: (agent) => {
      const live = get === undefined ? undefined : asIdentity(get(agent.id))
      return live !== undefined && live === agent && live.session?.header?.origin !== 'subagent'
    },
  }
}
