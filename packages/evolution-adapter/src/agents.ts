/**
 * The agents implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentIdentity, AgentsPort } from './contract/index.ts'

export type { AgentIdentity, AgentsPort } from './contract/index.ts'

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
